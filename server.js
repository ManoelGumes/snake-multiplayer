const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 40807; // Use the same port as before to match user's tunnel

app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/firebase-config.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send(`
        const firebaseConfig = {
            apiKey: "${process.env.FIREBASE_API_KEY || ''}",
            authDomain: "snake-774ff.firebaseapp.com",
            projectId: "snake-774ff",
            storageBucket: "snake-774ff.firebasestorage.app",
            messagingSenderId: "440583014104",
            appId: "1:440583014104:web:a12e1508196342176ab9ad",
            measurementId: "G-71HYEX333S",
            databaseURL: "https://snake-774ff-default-rtdb.firebaseio.com"
        };
    `);
});

let players = {};
let food = { x: 10, y: 10 };
const gridSize = 20;
const tileCountX = 20;
const tileCountY = 20;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initialize player
    players[socket.id] = {
        id: socket.id,
        name: 'Anônimo',
        active: true,
        head: { x: 10 * gridSize, y: 10 * gridSize },
        pathHistory: [],
        score: 0
    };

    // Send current game state to the new player
    socket.emit('init', { players, food });
    
    // Broadcast to others that a new player joined
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Handle state updates from players
    socket.on('update', (data) => {
        if (players[socket.id]) {
            players[socket.id].head = data.head;
            players[socket.id].pathHistory = data.pathHistory;
            players[socket.id].score = data.score;
            players[socket.id].name = data.name;
            
            // Broadcast update to all other players
            socket.broadcast.emit('update', players[socket.id]);
        }
    });

    // Handle food collection
    socket.on('eatFood', () => {
        food = {
            x: Math.floor(Math.random() * tileCountX),
            y: Math.floor(Math.random() * tileCountY)
        };
        io.emit('newFood', food);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
