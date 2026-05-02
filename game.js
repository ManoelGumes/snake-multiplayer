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
let tileCountX = Math.floor(canvas.width / gridSize);
let tileCountY = Math.floor(canvas.height / gridSize);

function resizeCanvas() {
    const headerEl = document.querySelector('header');
    const footerEl = document.querySelector('footer');
    const headerHeight = headerEl ? headerEl.offsetHeight : 0;
    const footerHeight = footerEl ? footerEl.offsetHeight : 0;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - headerHeight - footerHeight;
    
    tileCountX = Math.max(1, Math.floor(canvas.width / gridSize));
    tileCountY = Math.max(1, Math.floor(canvas.height / gridSize));
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

function initMultiplayer() {
    if (gameMode !== 'multi') return;

    console.log('Initializing multiplayer with Socket.io...');
    
    socket = io();

    socket.on('init', (data) => {
        console.log('Connected to server. Initial state received.');
        players = data.players;
        food = data.food;
        myPlayerId = socket.id; // Set my ID!
    });

    socket.on('playerJoined', (player) => {
        console.log('Player joined:', player.id);
        players[player.id] = player;
    });

    socket.on('update', (player) => {
        players[player.id] = player; // Add or update!
    });

    socket.on('newFood', (newFood) => {
        food = newFood;
    });

    socket.on('playerLeft', (id) => {
        console.log('Player left:', id);
        delete players[id];
    });
}

// Game State
let snakeLength = 3;
let pathHistory = [];
const spacingIndexDiff = 10;

let head = { x: 10 * gridSize, y: 10 * gridSize };
let velocity = { x: 1.5, y: 0 };
let nextVelocity = { x: 1.5, y: 0 };
let food = { x: 0, y: 0 };
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
    
    // Add mouse move listener for Slither.io controls
    window.addEventListener('mousemove', (e) => {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
    });
    
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
    head = { x: 10 * gridSize, y: 10 * gridSize };
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
    
    generateFood();
    generateObstacles();
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

    // Calculate angle towards mouse
    const dx = mousePos.x - head.x;
    const dy = mousePos.y - head.y;
    const angle = Math.atan2(dy, dx);
    
    // Update velocity based on angle
    velocity = {
        x: Math.cos(angle) * baseSpeed,
        y: Math.sin(angle) * baseSpeed
    };
    
    head.x += velocity.x;
    head.y += velocity.y;
    
    pathHistory.unshift({ x: head.x, y: head.y });
    if (pathHistory.length > snakeLength * spacingIndexDiff) {
        pathHistory.pop();
    }
    
    // Sync to Server
    if (gameMode === 'multi' && socket) {
        socket.emit('update', { head: head, pathHistory: pathHistory, score: score, name: username });
    }
    
    // Wrap around walls
    if (head.x < 0) head.x = canvas.width;
    else if (head.x >= canvas.width) head.x = 0;
    
    if (head.y < 0) head.y = canvas.height;
    else if (head.y >= canvas.height) head.y = 0;

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
            
            for (let j = 0; j < p.pathHistory.length; j += spacingIndexDiff) {
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
    if (!food) return;
    
    const foodCenterX = food.x * gridSize + gridSize / 2;
    const foodCenterY = food.y * gridSize + gridSize / 2;
    const distToFood = Math.hypot(head.x - foodCenterX, head.y - foodCenterY);
    
    if (distToFood < gridSize) {
        score += 10;
        updateScore();
        
        food = null; // Clear instantly to avoid double collision!
        
        if (gameMode === 'multi' && socket) {
            socket.emit('eatFood');
        } else {
            generateFood();
        }
        
        checkSpeedProgression();
        snakeLength++;
    }
}

function draw() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < tileCountX; i++) {
        ctx.beginPath();
        ctx.moveTo(i * gridSize, 0);
        ctx.lineTo(i * gridSize, canvas.height);
        ctx.stroke();
    }
    for (let i = 0; i < tileCountY; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * gridSize);
        ctx.lineTo(canvas.width, i * gridSize);
        ctx.stroke();
    }

    ctx.shadowBlur = 15;

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
    if (food) {
        const foodCenterX = food.x * gridSize + gridSize / 2;
        const foodCenterY = food.y * gridSize + gridSize / 2;
        const foodRadius = gridSize / 2 - 3;
        ctx.shadowColor = COLORS.food;
        ctx.beginPath();
        ctx.arc(foodCenterX, foodCenterY, foodRadius, 0, Math.PI * 2);
        const foodGradient = ctx.createRadialGradient(foodCenterX - foodRadius/3, foodCenterY - foodRadius/3, 1, foodCenterX, foodCenterY, foodRadius);
        foodGradient.addColorStop(0, '#fff');
        foodGradient.addColorStop(0.3, '#80f2ff');
        foodGradient.addColorStop(1, COLORS.food);
        ctx.fillStyle = foodGradient;
        ctx.fill();
    }

    // Draw All Other Players
    if (gameMode === 'multi' && myPlayerId) {
        const colors = ['#bd00ff', '#00e5ff', '#ff0055', '#ffaa00'];
        let colorIndex = 0;
        
        for (let id in players) {
            if (id === myPlayerId) continue;
            const p = players[id];
            if (!p.active || !p.pathHistory) continue;
            
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
    ctx.shadowBlur = 0;
}

function handleKeyDown(e) {
    switch (e.key) {
        case ' ': e.preventDefault(); break;
        case 'Enter': e.preventDefault(); break;
    }
}

function generateFood() {
    const newFood = { x: Math.floor(Math.random() * tileCountX), y: Math.floor(Math.random() * tileCountY) };
    if (isOccupied(newFood.x, newFood.y)) generateFood();
    else food = newFood;
}

function generateObstacles() {
    const numObstacles = 5;
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
    if (food && food.x === x && food.y === y) return true;
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
    const newLevel = Math.floor(score / 50) + 1;
    if (newLevel > speedLevel) {
        speedLevel = newLevel;
        baseSpeed = 1.5 + (speedLevel - 1) * 0.2;
        currentSpeedEl.textContent = `${speedLevel}x`;
    }
}

function triggerGameOver() {
    isGameOver = true;
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
