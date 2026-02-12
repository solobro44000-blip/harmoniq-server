const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// --- CONFIGURATION ---
// Set to "*" to prevent any CORS issues across your different deployments
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));

// --- KEEP-ALIVE ROUTE (For Cron Job) ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Harmoniq Server Status</title>
            <style>
                body {
                    background-color: #0f0f0f;
                    color: #00ff88;
                    font-family: 'Courier New', Courier, monospace;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }
                .container {
                    border: 2px solid #333;
                    padding: 2rem;
                    border-radius: 10px;
                    background-color: #1a1a1a;
                    box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
                    text-align: center;
                }
                h1 { margin-top: 0; }
                .status { font-size: 1.5rem; font-weight: bold; }
                .blink { animation: blinker 1.5s linear infinite; }
                @keyframes blinker { 50% { opacity: 0; } }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>HarmoniqBeatX Server</h1>
                <p>Status: <span class="status">ONLINE 🟢</span></p>
                <p class="blink">Listening for socket connections...</p>
            </div>
        </body>
        </html>
    `);
});

const server = http.createServer(app);

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store who is the host of which room
const roomHosts = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- 1. CREATE ROOM ---
    socket.on('createRoom', () => {
        // Generate a random 4-letter code
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        socket.join(roomCode);
        roomHosts.set(roomCode, socket.id); // The creator is the Host
        
        console.log(`Room created: ${roomCode} by ${socket.id}`);
        socket.emit('roomCreated', roomCode);
    });

    // --- 2. JOIN ROOM ---
    socket.on('joinRoom', (roomCode) => {
        if (!roomCode) return;
        const upperCode = roomCode.toUpperCase();
        const room = io.sockets.adapter.rooms.get(upperCode);

        if (room) {
            socket.join(upperCode);
            console.log(`User ${socket.id} joined room ${upperCode}`);
            socket.emit('roomJoined', upperCode);
            
            // Notify other users in the room
            socket.to(upperCode).emit('userJoined');
        } else {
            socket.emit('error', 'Room not found! Check the code.');
        }
    });

    // --- 3. SYNC REQUESTS (Guest -> Server -> Host) ---
    // When a guest joins, they request the current state
    socket.on('requestSync', (roomId) => {
        const hostId = roomHosts.get(roomId);
        if (hostId) {
            io.to(hostId).emit('requestSync');
        }
    });

    // --- 4. SYNC DATA (Host -> Server -> Guests) ---
    // The host responds with the current track and timestamp
    socket.on('syncData', (data) => {
        // Expected data: { room, track, time, isPlaying }
        if (data && data.room) {
            socket.to(data.room).emit('syncData', data);
        }
    });

    // --- 5. PLAYBACK CONTROLS (Host -> Server -> Guests) ---
    socket.on('play', (data) => {
        // Expected data: { room, time }
        if (data && data.room) {
            socket.to(data.room).emit('play', data);
        }
    });

    socket.on('pause', (data) => {
        // Expected data: { room, time }
        if (data && data.room) {
            socket.to(data.room).emit('pause', data);
        }
    });

    socket.on('changeTrack', (data) => {
        // Expected data: { room, track, time, isPlaying }
        if (data && data.room) {
            socket.to(data.room).emit('changeTrack', data);
        }
    });

    // --- 6. LEAVE ROOM ---
    socket.on('leaveRoom', (roomCode) => {
        if (roomCode) {
            socket.leave(roomCode);
            socket.to(roomCode).emit('userLeft');
            
            if (roomHosts.get(roomCode) === socket.id) {
                roomHosts.delete(roomCode);
            }
        }
    });

    // --- 7. DISCONNECT ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
