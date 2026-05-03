const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const currentScoreEl = document.getElementById('current-score');
const highScoreEl = document.getElementById('high-score');
const currentSpeedEl = document.getElementById('current-speed');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayMessageEl = document.getElementById('overlay-message');
const startSoloBtn = document.getElementById('start-solo-btn');
const startMultiBtn = document.getElementById('start-multi-btn');
const usernameInputEl = document.getElementById('username-input');
const leaderboardListEl = document.getElementById('leaderboard-list');

// Grid and Game Settings
const gridSize = 20;
const WORLD_WIDTH = 2500;
const WORLD_HEIGHT = 2500;
let tileCountX = Math.floor(WORLD_WIDTH / gridSize);
let tileCountY = Math.floor(WORLD_HEIGHT / gridSize);
let camera = { x: 0, y: 0 };

function resizeCanvas() {
    const headerEl = document.querySelector('header');
    const footerEl = document.querySelector('footer');
    const headerHeight = headerEl ? headerEl.offsetHeight : 0;
    const footerHeight = footerEl ? footerEl.offsetHeight : 0;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - headerHeight - footerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Initialize Firebase
let database = null;
let gameRef = null;
try {
    // firebaseConfig is provided by /firebase-config.js loaded in index.html
    firebase.initializeApp(firebaseConfig);
    database = firebase.database();
    gameRef = database.ref('games/current_session');
} catch (e) {
    console.error('Firebase initialization failed:', e);
}

// Initialize Socket.io
let socket = null;
let gameMode = 'solo'; // 'solo' or 'multi'
let myPlayerId = null;
let players = {}; // Stores all players in the session
let otherPlayerSnake = null; // For 2-player mode
let mousePos = { x: 0, y: 0 }; // For Slither.io style controls
let lastEmitTime = 0; // For throttling

function initMultiplayer() {
    if (gameMode !== 'multi') return;

    console.log('Initializing multiplayer with Socket.io...');
    
    socket = io();

    socket.on('init', (data) => {
        console.log('Connected to server. Initial state received.');
        players = data.players;
        foods = data.foods;
        myPlayerId = socket.id; // Set my ID!
        updatePlayerCount();
    });

    socket.on('playerJoined', (player) => {
        console.log('Player joined:', player.id);
        players[player.id] = player;
        updatePlayerCount();
    });

    socket.on('update', (player) => {
        if (!players[player.id]) {
            players[player.id] = player;
        } else {
            // Resize pathHistory to match target length
            while (players[player.id].pathHistory.length < player.pathHistory.length) {
                const lastPt = players[player.id].pathHistory[players[player.id].pathHistory.length - 1] || player.head;
                players[player.id].pathHistory.push({ x: lastPt.x, y: lastPt.y });
            }
            while (players[player.id].pathHistory.length > player.pathHistory.length) {
                players[player.id].pathHistory.pop();
            }
            
            players[player.id].targetPathHistory = player.pathHistory;
            players[player.id].score = player.score;
            players[player.id].name = player.name;
            players[player.id].active = player.active;
            players[player.id].head = player.head;
        }
    });

    socket.on('newFoods', (newFoods) => {
        foods = newFoods;
    });

    socket.on('playerLeft', (id) => {
        console.log('Player left:', id);
        delete players[id];
        updatePlayerCount();
    });

    socket.on('gameOver', (data) => {
        console.log('Game Over received. Winner:', data.winner);
        isGameOver = true;
        const overlayEl = document.getElementById('overlay');
        const overlayTitleEl = document.getElementById('overlay-title');
        const overlayMessageEl = document.getElementById('overlay-message');
        
        if (overlayEl) overlayEl.classList.add('visible');
        if (overlayTitleEl) overlayTitleEl.textContent = "FIM DE JOGO";
        if (overlayMessageEl) overlayMessageEl.textContent = `Vencedor: ${data.winner}`;
    });
}

// Game State
let snakeLength = 3;
let pathHistory = [];
const spacingIndexDiff = 10;

let head = { x: 10 * gridSize, y: 10 * gridSize };
let velocity = { x: 1.5, y: 0 };
let nextVelocity = { x: 1.5, y: 0 };
let foods = [];
let obstacles = [];
let score = 0;
let highScore = 0;
try {
    highScore = localStorage.getItem('snakeHighScore') || 0;
} catch (e) {
    console.warn('localStorage not available:', e);
}
let speedLevel = 1;
let isGameOver = false;
let baseSpeed = 1.5;

const COLORS = {
    bg: '#07080c',
    snake: '#00ff88',
    food: '#00e5ff',
    obstacle: '#ff0055',
    grid: '#111420'
};

highScoreEl.textContent = String(highScore).padStart(3, '0');

// --- Event Listeners ---
document.addEventListener('keydown', handleKeyDown);

function setupListeners() {
    console.log('Setting up listeners');
    const startSoloBtn = document.getElementById('start-solo-btn');
    const startMultiBtn = document.getElementById('start-multi-btn');

    if (startSoloBtn) {
        startSoloBtn.addEventListener('click', () => { console.log('Solo clicked'); gameMode = 'solo'; startGame(); });
    } else {
        console.error('start-solo-btn not found!');
    }
    
    if (startMultiBtn) {
        startMultiBtn.addEventListener('click', () => { console.log('Multi clicked'); gameMode = 'multi'; startGame(); });
    } else {
        console.error('start-multi-btn not found!');
    }
    
    const ctrlUp = document.getElementById('ctrl-up');
    const ctrlDown = document.getElementById('ctrl-down');
    const ctrlLeft = document.getElementById('ctrl-left');
    const ctrlRight = document.getElementById('ctrl-right');
    
    if (ctrlUp) {
        ctrlUp.addEventListener('touchstart', (e) => { e.preventDefault(); if (velocity.y === 0) nextVelocity = { x: 0, y: -baseSpeed }; });
        ctrlUp.addEventListener('click', () => { if (velocity.y === 0) nextVelocity = { x: 0, y: -baseSpeed }; });
    }
    if (ctrlDown) {
        ctrlDown.addEventListener('touchstart', (e) => { e.preventDefault(); if (velocity.y === 0) nextVelocity = { x: 0, y: baseSpeed }; });
        ctrlDown.addEventListener('click', () => { if (velocity.y === 0) nextVelocity = { x: 0, y: baseSpeed }; });
    }
    if (ctrlLeft) {
        ctrlLeft.addEventListener('touchstart', (e) => { e.preventDefault(); if (velocity.x === 0) nextVelocity = { x: -baseSpeed, y: 0 }; });
        ctrlLeft.addEventListener('click', () => { if (velocity.x === 0) nextVelocity = { x: -baseSpeed, y: 0 }; });
    }
    if (ctrlRight) {
        ctrlRight.addEventListener('touchstart', (e) => { e.preventDefault(); if (velocity.x === 0) nextVelocity = { x: baseSpeed, y: 0 }; });
        ctrlRight.addEventListener('click', () => { if (velocity.x === 0) nextVelocity = { x: baseSpeed, y: 0 }; });
    }
    
    loadLeaderboard();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupListeners);
} else {
    setupListeners();
}

// --- Game Loop ---
function gameLoop() {
    if (isGameOver) return;
    
    try {
        update();
        draw();
    } catch (e) {
        console.error('Error in game loop:', e);
        isGameOver = true;
        return;
    }
    
    requestAnimationFrame(gameLoop);
}

// --- Game Logic ---
function startGame() {
    console.log('startGame called');
    const usernameInputEl = document.getElementById('username-input');
    const overlayMessageEl = document.getElementById('overlay-message');
    const overlayEl = document.getElementById('overlay');
    
    if (!usernameInputEl || !overlayMessageEl || !overlayEl) {
        console.error('Required UI elements not found!');
        return;
    }
    
    username = usernameInputEl.value.trim();
    
    if (username.length < 3) {
        overlayMessageEl.textContent = "O nome deve ter pelo menos 3 caracteres!";
        overlayMessageEl.style.color = "#ff0055";
        return;
    }
    
    // Reset message style if it was changed by error
    overlayMessageEl.textContent = "Digite seu nome para entrar no ranking.";
    overlayMessageEl.style.color = "var(--text-muted)";
    
    if (gameMode === 'multi') {
        initMultiplayer();
    }
    
    resetGame();
    overlayEl.classList.remove('visible');
    requestAnimationFrame(gameLoop);
}

function resetGame() {
    baseSpeed = 1.5;
    head = {
        x: Math.floor(Math.random() * (tileCountX - 4) + 2) * gridSize,
        y: Math.floor(Math.random() * (tileCountY - 4) + 2) * gridSize
    };
    velocity = { x: baseSpeed, y: 0 };
    nextVelocity = { x: baseSpeed, y: 0 };
    score = 0;
    speedLevel = 1;
    isGameOver = false;
    obstacles = [];
    snakeLength = 3;
    pathHistory = [];
    
    for (let i = 0; i < snakeLength * spacingIndexDiff; i++) {
        pathHistory.push({ x: head.x - i * velocity.x, y: head.y - i * velocity.y });
    }
    
    const currentScoreEl = document.getElementById('current-score');
    const currentSpeedEl = document.getElementById('current-speed');
    
    if (currentScoreEl) currentScoreEl.textContent = '000';
    if (currentSpeedEl) currentSpeedEl.textContent = '1x';
    
    foods = [];
    for (let i = 0; i < 50; i++) {
        generateFood(i);
    }
    generateObstacles();
    updatePlayerCount();
}

function update() {
    if (isGameOver) return;

    // Move obstacles
    obstacles.forEach(obs => {
        obs.x += obs.vx;
        obs.y += obs.vy;

        if (obs.x < 0 || obs.x >= tileCountX - 1) obs.vx *= -1;
        if (obs.y < 0 || obs.y >= tileCountY - 1) obs.vy *= -1;
    });

    velocity = nextVelocity;
    
    head.x += velocity.x;
    head.y += velocity.y;
    
    // Update camera to center on head
    camera.x = head.x - canvas.width / 2;
    camera.y = head.y - canvas.height / 2;
    
    pathHistory.unshift({ x: head.x, y: head.y });
    if (pathHistory.length > snakeLength * spacingIndexDiff) {
        pathHistory.pop();
    }
    
    // Sync to Server
    if (gameMode === 'multi' && socket) {
        const currentTime = Date.now();
        if (currentTime - lastEmitTime > 50) { // 20 FPS
            const sparseHistory = [];
            for (let i = 0; i < snakeLength; i++) {
                const idx = i * spacingIndexDiff;
                if (idx < pathHistory.length) {
                    sparseHistory.push(pathHistory[idx]);
                }
            }
            socket.emit('update', { head: head, pathHistory: sparseHistory, score: score, name: username });
            lastEmitTime = currentTime;
        }
    }
    
    // Block at world boundaries
    if (head.x < 0) head.x = 0;
    else if (head.x >= WORLD_WIDTH) head.x = WORLD_WIDTH - 1;
    
    if (head.y < 0) head.y = 0;
    else if (head.y >= WORLD_HEIGHT) head.y = WORLD_HEIGHT - 1;

    // Collision Detection (Self)
    for (let i = spacingIndexDiff * 2; i < pathHistory.length; i += spacingIndexDiff) {
        const part = pathHistory[i];
        const dist = Math.hypot(head.x - part.x, head.y - part.y);
        if (dist < gridSize / 2) {
            triggerGameOver();
            return;
        }
    }

    // Collision Detection (Other Player)
    if (gameMode === 'multi' && otherPlayerSnake && otherPlayerSnake.pathHistory) {
        for (let j = 0; j < otherPlayerSnake.pathHistory.length; j += spacingIndexDiff) {
            const part = otherPlayerSnake.pathHistory[j];
            const dist = Math.hypot(head.x - part.x, head.y - part.y);
            if (dist < gridSize / 2) {
                triggerGameOver();
                return;
            }
        }
    }

    // Collision Detection (Other Players)
    if (gameMode === 'multi' && myPlayerId) {
        for (let id in players) {
            if (id === myPlayerId) continue;
            const p = players[id];
            if (!p.active || !p.pathHistory) continue;
            
            for (let j = 0; j < p.pathHistory.length; j++) {
                const part = p.pathHistory[j];
                const dist = Math.hypot(head.x - part.x, head.y - part.y);
                if (dist < gridSize / 2) {
                    triggerGameOver();
                    return;
                }
            }
        }
    }

    // Collision Detection (Obstacles)
    for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i];
        const obsCenterX = obs.x * gridSize + gridSize / 2;
        const obsCenterY = obs.y * gridSize + gridSize / 2;
        const dist = Math.hypot(head.x - obsCenterX, head.y - obsCenterY);
        if (dist < gridSize / 2 + gridSize / 3) {
            triggerGameOver();
            return;
        }
    }

    // Collision Detection (Food)
    if (!foods) return;
    
    foods.forEach((foodItem, index) => {
        if (!foodItem) return;
        const foodCenterX = foodItem.x * gridSize + gridSize / 2;
        const foodCenterY = foodItem.y * gridSize + gridSize / 2;
        const distToFood = Math.hypot(head.x - foodCenterX, head.y - foodCenterY);
        
        if (distToFood < gridSize) {
            score += 10;
            updateScore();
            
            foods[index] = null; // Clear locally
            
            if (gameMode === 'multi' && socket) {
                socket.emit('eatFood', index);
            } else {
                generateFood(index);
            }
            
            checkSpeedProgression();
            snakeLength++;
        }
    });
}

function draw() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < tileCountX; i++) {
        ctx.beginPath();
        ctx.moveTo(i * gridSize, 0);
        ctx.lineTo(i * gridSize, WORLD_HEIGHT);
        ctx.stroke();
    }
    for (let i = 0; i < tileCountY; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * gridSize);
        ctx.lineTo(WORLD_WIDTH, i * gridSize);
        ctx.stroke();
    }

    ctx.shadowBlur = 15;

    // Draw World Border
    ctx.strokeStyle = '#ff0055'; // Neon pink
    ctx.lineWidth = 10;
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 20;
    ctx.strokeRect(5, 5, WORLD_WIDTH - 10, WORLD_HEIGHT - 10);
    ctx.shadowBlur = 15; // Restore default blur

    // Draw Obstacles
    obstacles.forEach(obs => {
        const centerX = obs.x * gridSize + gridSize / 2;
        const centerY = obs.y * gridSize + gridSize / 2;
        const radius = gridSize / 2 - 2;
        ctx.shadowColor = COLORS.obstacle;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(centerX - radius/3, centerY - radius/3, 1, centerX, centerY, radius);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(0.2, '#ff4d88');
        gradient.addColorStop(1, COLORS.obstacle);
        ctx.fillStyle = gradient;
        ctx.fill();
    });

    // Draw Food
    if (foods) {
        foods.forEach(foodItem => {
            if (!foodItem) return;
            
            const foodCenterX = foodItem.x * gridSize + gridSize / 2;
            const foodCenterY = foodItem.y * gridSize + gridSize / 2;
            const foodRadius = gridSize / 2 - 3;
            
            // Fade in animation
            const elapsed = Date.now() - (foodItem.spawnTime || 0);
            const alpha = Math.min(elapsed / 500, 1); // Fade in over 500ms
            
            ctx.save();
            ctx.globalAlpha = alpha;
            
            ctx.shadowColor = COLORS.food;
            ctx.beginPath();
            ctx.arc(foodCenterX, foodCenterY, foodRadius, 0, Math.PI * 2);
            const foodGradient = ctx.createRadialGradient(foodCenterX - foodRadius/3, foodCenterY - foodRadius/3, 1, foodCenterX, foodCenterY, foodRadius);
            foodGradient.addColorStop(0, '#fff');
            foodGradient.addColorStop(0.3, '#80f2ff');
            foodGradient.addColorStop(1, COLORS.food);
            ctx.fillStyle = foodGradient;
            ctx.fill();
            
            ctx.restore();
        });
    }

    // Draw All Other Players
    if (gameMode === 'multi' && myPlayerId) {
        const colors = ['#bd00ff', '#00e5ff', '#ff0055', '#ffaa00'];
        let colorIndex = 0;
        
        for (let id in players) {
            if (id === myPlayerId) continue;
            const p = players[id];
            if (!p.active || !p.pathHistory) continue;
            
            // Interpolate positions for smooth movement
            if (p.targetPathHistory) {
                p.pathHistory.forEach((part, index) => {
                    const targetPart = p.targetPathHistory[index];
                    if (targetPart) {
                        part.x += (targetPart.x - part.x) * 0.2;
                        part.y += (targetPart.y - part.y) * 0.2;
                    }
                });
            }
            
            const pColor = colors[colorIndex % colors.length];
            colorIndex++;
            
            ctx.shadowColor = pColor;
            
            p.pathHistory.forEach((part, index) => {
                const isHead = index === 0;
                const centerX = part.x;
                const centerY = part.y;
                const radius = gridSize / 2 - (isHead ? 0 : 1);

                if (isHead) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '12px Arial';
                    ctx.textAlign = 'center';
                    ctx.shadowBlur = 0;
                    ctx.fillText(p.name || 'Anônimo', centerX, centerY - radius - 5);
                    ctx.shadowBlur = 15;
                }

                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                
                const gradient = ctx.createRadialGradient(
                    centerX - radius / 3, centerY - radius / 3, 1,
                    centerX, centerY, radius
                );
                
                if (isHead) {
                    gradient.addColorStop(0, '#fff');
                    gradient.addColorStop(0.4, pColor);
                    gradient.addColorStop(1, pColor);
                } else {
                    gradient.addColorStop(0, pColor);
                    gradient.addColorStop(0.6, pColor);
                    gradient.addColorStop(1, '#000');
                }
                
                ctx.fillStyle = gradient;
                ctx.fill();
            });
        }
    }

    // Find closest food and draw arrow
    if (foods) {
        let closestFood = null;
        let minDist = Infinity;
        foods.forEach(foodItem => {
            if (!foodItem) return;
            const foodCenterX = foodItem.x * gridSize + gridSize / 2;
            const foodCenterY = foodItem.y * gridSize + gridSize / 2;
            const dist = Math.hypot(head.x - foodCenterX, head.y - foodCenterY);
            if (dist < minDist) {
                minDist = dist;
                closestFood = foodItem;
            }
        });
        
        if (closestFood) {
            const foodCenterX = closestFood.x * gridSize + gridSize / 2;
            const foodCenterY = closestFood.y * gridSize + gridSize / 2;
            const angle = Math.atan2(foodCenterY - head.y, foodCenterX - head.x);
            
            ctx.save();
            ctx.translate(head.x, head.y);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(30, 0); // Distance from head
            ctx.lineTo(20, -5);
            ctx.lineTo(20, 5);
            ctx.closePath();
            ctx.fillStyle = '#00e5ff'; // Same as food
            ctx.fill();
            ctx.restore();
        }
    }

    // Draw Snake
    for (let i = 0; i < snakeLength; i++) {
        const index = i * spacingIndexDiff;
        if (index >= pathHistory.length) break;
        const part = pathHistory[index];
        const isHead = i === 0;
        const centerX = part.x;
        const centerY = part.y;
        const radius = gridSize / 2 - (isHead ? 0 : 1);

        ctx.shadowColor = COLORS.snake;
        
        if (isHead) {
            // Draw name
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.shadowBlur = 0;
            ctx.fillText(username, centerX, centerY - radius - 5);
            ctx.shadowBlur = 15;

            const mouthAngle = 0.25 * Math.PI * (0.5 + 0.5 * Math.sin(Date.now() / 100));
            let baseAngle = 0;
            if (velocity.x > 0) baseAngle = 0;
            else if (velocity.x < 0) baseAngle = Math.PI;
            else if (velocity.y > 0) baseAngle = Math.PI / 2;
            else if (velocity.y < 0) baseAngle = -Math.PI / 2;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, baseAngle + mouthAngle, baseAngle - mouthAngle + Math.PI * 2);
            ctx.closePath();
        } else {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        }
        
        const snakeGradient = ctx.createRadialGradient(centerX - radius/3, centerY - radius/3, 1, centerX, centerY, radius);
        if (isHead) {
            snakeGradient.addColorStop(0, '#fff');
            snakeGradient.addColorStop(0.4, '#80ffc4');
            snakeGradient.addColorStop(1, COLORS.snake);
        } else {
            snakeGradient.addColorStop(0, '#80ffc4');
            snakeGradient.addColorStop(0.6, COLORS.snake);
            snakeGradient.addColorStop(1, '#00b35f');
        }
        ctx.fillStyle = snakeGradient;
        ctx.fill();

        if (isHead) {
            ctx.fillStyle = '#000';
            ctx.shadowBlur = 0;
            let eyeOffsetX = 0, eyeOffsetY = 0;
            if (velocity.x > 0) { eyeOffsetX = 3; eyeOffsetY = 3; }
            else if (velocity.x < 0) { eyeOffsetX = -3; eyeOffsetY = 3; }
            else if (velocity.y > 0) { eyeOffsetX = 3; eyeOffsetY = 3; }
            else if (velocity.y < 0) { eyeOffsetX = 3; eyeOffsetY = -3; }
            
            ctx.beginPath();
            ctx.arc(centerX + eyeOffsetX, centerY + (velocity.x !== 0 ? -3 : 0), 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(centerX + (velocity.y !== 0 ? -3 : eyeOffsetX), centerY + (velocity.y !== 0 ? eyeOffsetY : 3), 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 15;
        }
    }
    
    ctx.restore(); // Restore for UI
    
    // Draw Mini-map
    const mapSize = 100;
    const mapX = canvas.width - mapSize - 20;
    const mapY = canvas.height - mapSize - 20;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(mapX, mapY, mapSize, mapSize);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);
    
    // Draw local player dot
    const localX = mapX + (head.x / WORLD_WIDTH) * mapSize;
    const localY = mapY + (head.y / WORLD_HEIGHT) * mapSize;
    ctx.fillStyle = COLORS.snake;
    ctx.beginPath();
    ctx.arc(localX, localY, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw other players dots
    for (let id in players) {
        const p = players[id];
        if (!p.active || !p.head) continue;
        const otherX = mapX + (p.head.x / WORLD_WIDTH) * mapSize;
        const otherY = mapY + (p.head.y / WORLD_HEIGHT) * mapSize;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(otherX, otherY, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.shadowBlur = 0;
}

function handleKeyDown(e) {
    switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
            if (velocity.y === 0) nextVelocity = { x: 0, y: -baseSpeed };
            break;
        case 'ArrowDown': case 's': case 'S':
            if (velocity.y === 0) nextVelocity = { x: 0, y: baseSpeed };
            break;
        case 'ArrowLeft': case 'a': case 'A':
            if (velocity.x === 0) nextVelocity = { x: -baseSpeed, y: 0 };
            break;
        case 'ArrowRight': case 'd': case 'D':
            if (velocity.x === 0) nextVelocity = { x: baseSpeed, y: 0 };
            break;
        case ' ': e.preventDefault(); break;
        case 'Enter': e.preventDefault(); break;
        case 'Escape': case 'Esc':
            returnToHome();
            break;
    }
}

function returnToHome() {
    isGameOver = true;
    const overlayEl = document.getElementById('overlay');
    const overlayTitleEl = document.getElementById('overlay-title');
    const overlayMessageEl = document.getElementById('overlay-message');
    const startSoloBtn = document.getElementById('start-solo-btn');
    
    if (overlayEl) overlayEl.classList.add('visible');
    if (overlayTitleEl) overlayTitleEl.textContent = "NEON SNAKE";
    if (overlayMessageEl) overlayMessageEl.textContent = "Digite seu nome para entrar no ranking.";
    if (startSoloBtn) startSoloBtn.textContent = "JOGAR SOLO";
}

function generateFood(index = 0) {
    const newFood = { x: Math.floor(Math.random() * tileCountX), y: Math.floor(Math.random() * tileCountY) };
    if (isOccupied(newFood.x, newFood.y)) generateFood(index);
    else {
        if (!foods) foods = [];
        foods[index] = newFood;
    }
}

function generateObstacles() {
    const numObstacles = 30;
    for (let i = 0; i < numObstacles; i++) {
        const obs = {
            x: Math.floor(Math.random() * (tileCountX - 2)) + 1,
            y: Math.floor(Math.random() * (tileCountY - 2)) + 1,
            vx: (Math.random() - 0.5) * 0.2,
            vy: (Math.random() - 0.5) * 0.2
        };
        if (!isOccupied(obs.x, obs.y) && Math.abs(obs.x - 10) > 3) obstacles.push(obs);
    }
}

function isOccupied(x, y) {
    const cellCenterX = x * gridSize + gridSize / 2;
    const cellCenterY = y * gridSize + gridSize / 2;
    for (let p of pathHistory) {
        const dist = Math.hypot(cellCenterX - p.x, cellCenterY - p.y);
        if (dist < gridSize / 2) return true;
    }
    for (let o of obstacles) {
        const obsCenterX = o.x * gridSize + gridSize / 2;
        const obsCenterY = o.y * gridSize + gridSize / 2;
        const dist = Math.hypot(cellCenterX - obsCenterX, cellCenterY - obsCenterY);
        if (dist < gridSize) return true;
    }
    if (foods) {
        for (let f of foods) {
            if (f && f.x === x && f.y === y) return true;
        }
    }
    return false;
}

function updateScore() {
    currentScoreEl.textContent = String(score).padStart(3, '0');
    if (score > highScore) {
        highScore = score;
        highScoreEl.textContent = String(highScore).padStart(3, '0');
        try { localStorage.setItem('snakeHighScore', highScore); } catch (e) {}
    }
}

function checkSpeedProgression() {
    const maxLevel = 5; // Max speed at 20 foods (200 points)
    const newLevel = Math.min(Math.floor(score / 50) + 1, maxLevel);
    if (newLevel > speedLevel) {
        speedLevel = newLevel;
        baseSpeed = 1.5 + (speedLevel - 1) * 0.2;
        currentSpeedEl.textContent = `${speedLevel}x`;
    }
}

function triggerGameOver() {
    isGameOver = true;
    
    if (gameMode === 'multi' && socket) {
        socket.emit('playerDied');
    }
    
    overlayTitleEl.textContent = "GAME OVER";
    overlayMessageEl.textContent = `${usernameInputEl.value.trim()}, sua pontuação foi ${score}.`;
    startSoloBtn.textContent = "JOGAR NOVAMENTE";
    
    // Save score to leaderboard
    saveScore();
    
    overlayEl.classList.add('visible');
}

function saveScore() {
    if (!database) {
        console.warn('Database not available, score not saved.');
        return;
    }
    const leaderboardRef = database.ref('leaderboard');
    const username = usernameInputEl.value.trim();
    
    leaderboardRef.orderByChild('name').equalTo(username).once('value', (snapshot) => {
        const data = snapshot.val();
        
        if (data) {
            const key = Object.keys(data)[0];
            const existingScore = data[key].score;
            
            if (score > existingScore) {
                leaderboardRef.child(key).update({
                    score: score,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                }).then(() => {
                    console.log('Score updated successfully');
                    loadLeaderboard();
                });
            } else {
                console.log('Score not higher than existing best');
                loadLeaderboard();
            }
        } else {
            leaderboardRef.push({
                name: username,
                score: score,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            }).then(() => {
                console.log('New score saved successfully');
                loadLeaderboard();
            });
        }
    }).catch((error) => {
        console.error('Error querying leaderboard:', error);
        leaderboardRef.push({
            name: username,
            score: score,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).then(() => {
            loadLeaderboard();
        });
    });
}

function loadLeaderboard() {
    if (!database) return;
    const leaderboardRef = database.ref('leaderboard');
    leaderboardRef.orderByChild('score').limitToLast(5).once('value', (snapshot) => {
        const data = snapshot.val();
        const listEl = document.getElementById('leaderboard-list');
        if (!listEl) return;
        
        listEl.innerHTML = '';
        
        if (!data) {
            listEl.innerHTML = '<li>Nenhuma pontuação ainda!</li>';
            return;
        }
        
        const scores = [];
        for (let key in data) {
            scores.push(data[key]);
        }
        scores.sort((a, b) => b.score - a.score);
        
        scores.forEach((item, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="rank">#${index + 1}</span> <span class="name">${item.name}</span> <span class="score">${String(item.score).padStart(3, '0')}</span>`;
            listEl.appendChild(li);
        });
    });
}

function updatePlayerCount() {
    const playerCountEl = document.getElementById('player-count');
    if (playerCountEl) {
        if (gameMode === 'solo') {
            playerCountEl.textContent = '01';
        } else {
            const count = Object.keys(players).length;
            playerCountEl.textContent = String(count).padStart(2, '0');
        }
    }
}
