const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// --- CONFIGURATION ---
// 1. Allow your specific website to connect
// 2. Allow "localhost" so you can test it on your own computer before uploading
const allowedOrigins = [
    "https://harmoniqbeatx.ccbp.tech",
    "http://127.0.0.1:5500", // Common local testing port
    "http://localhost:3000"
];

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"]
}));

// --- KEEP-ALIVE ROUTE (For Cron Job) ---
// When you visit the server URL directly, this page will show up.
// Set your Cron Job to ping this URL every 14 minutes.
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
        origin: allowedOrigins,
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

            // Ask the Host to send their current song info to this new user
            const hostId = roomHosts.get(upperCode);
            if (hostId) {
                io.to(hostId).emit('requestSync', socket.id);
            }
        } else {
            socket.emit('error', 'Room not found! Check the code.');
        }
    });

    // --- 3. SYNC DATA (Host -> New Guest) ---
    socket.on('sendSyncData', (data) => {
        // data: { targetGuestId, currentTime, songIndex/Url, isPlaying }
        if (data.targetGuestId) {
            io.to(data.targetGuestId).emit('syncGuest', data);
        }
    });

    // --- 4. PLAYBACK CONTROLS (Broadcast to everyone else) ---
    
    // Play
    socket.on('play', (roomCode) => {
        socket.to(roomCode).emit('play');
    });

    // Pause
    socket.on('pause', (roomCode) => {
        socket.to(roomCode).emit('pause');
    });

    // Seek (Change Time)
    socket.on('seek', (data) => {
        // data: { roomCode, time }
        socket.to(data.roomCode).emit('seek', data.time);
    });

    // Change Track (Next/Prev)
    socket.on('changeTrack', (data) => {
        // data: { roomCode, songIndex }
        socket.to(data.roomCode).emit('changeTrack', data.songIndex);
    });

    // --- 5. DISCONNECT ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Use the port Render assigns, or 3000 locally
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
