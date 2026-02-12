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

    // Helper to broadcast user count
    const broadcastUserCount = (roomCode) => {
        const room = io.sockets.adapter.rooms.get(roomCode);
        const count = room ? room.size : 0;
        io.to(roomCode).emit('updateUserCount', { count });
    };

    // --- 1. CREATE ROOM ---
    socket.on('createRoom', () => {
        // Generate a random 4-letter code
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        socket.join(roomCode);
        roomHosts.set(roomCode, socket.id); // The creator is the Host
        
        console.log(`Room created: ${roomCode} by ${socket.id}`);
        socket.emit('roomCreated', roomCode);

        // Emit initial count (1)
        socket.emit('updateUserCount', { count: 1 });
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

            // Ask the Host to send their current song info to this new user
            const hostId = roomHosts.get(upperCode);
            if (hostId) {
                io.to(hostId).emit('requestSync', socket.id);
            }

            // Update Count for Everyone
            broadcastUserCount(upperCode);
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
        if (data && data.room) {
            socket.to(data.room).emit('play', data);
        }
    });

    socket.on('pause', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('pause', data);
        }
    });

    socket.on('changeTrack', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('changeTrack', data);
        }
    });

    // --- 6. CHAT (Broadcast to others) ---
    socket.on('chatMessage', (data) => {
        // data: { room, message, senderName }
        if (data.room && data.message) {
            socket.to(data.room).emit('chatMessage', data);
        }
    });

    // --- 7. LEAVE ROOM (Updated for Host Logic) ---
    socket.on('leaveRoom', (roomCode) => {
        if (roomCode) {
            const isHost = roomHosts.get(roomCode) === socket.id;

            if (isHost) {
                // If Host leaves, close the room for everyone
                io.to(roomCode).emit('roomClosed'); 
                io.in(roomCode).socketsLeave(roomCode); // Force everyone out
                roomHosts.delete(roomCode);
                console.log(`Room closed by host: ${roomCode}`);
            } else {
                // If Guest leaves, just notify others
                socket.leave(roomCode);
                socket.to(roomCode).emit('userLeft');
                // Update count after guest leaves
                broadcastUserCount(roomCode);
            }
        }
    });

    // --- 8. DISCONNECT & DISCONNECTING ---
    // 'disconnecting' runs BEFORE the user leaves rooms, allowing us to see where they were
    socket.on('disconnecting', () => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                // Determine new count (current size - 1 since they are leaving)
                const roomData = io.sockets.adapter.rooms.get(room);
                const newCount = roomData ? roomData.size - 1 : 0;
                
                // Only broadcast if people remain
                if (newCount > 0) {
                    socket.to(room).emit('updateUserCount', { count: newCount });
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Check if this user was a host of any room
        for (const [roomCode, hostId] of roomHosts.entries()) {
            if (hostId === socket.id) {
                // Host disconnected -> Close room
                io.to(roomCode).emit('roomClosed');
                io.in(roomCode).socketsLeave(roomCode);
                roomHosts.delete(roomCode);
                console.log(`Host disconnected, closed room: ${roomCode}`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
