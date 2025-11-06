require('dotenv').config(); // Load .env file

const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const xss = require('xss');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// --- Middleware ---
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*', // Use FRONTEND_URL from .env
    methods: ['GET', 'POST'],
  })
);
app.use(bodyParser.json());

// --- Serve frontend in production ---
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

// --- Port from .env ---
const PORT = process.env.PORT || 4001;
app.set('port', PORT);

// --- Helper ---
const sanitizeString = (str) => xss(str);

// --- In-memory storage ---
const connections = {};
const messages = {};
const timeOnline = {};

// --- Socket.io logic ---
io.on('connection', (socket) => {

  socket.on('join-call', (path) => {
    if (!connections[path]) connections[path] = [];
    connections[path].push(socket.id);
    timeOnline[socket.id] = new Date();

    // Notify all users in the room
    connections[path].forEach((id) => {
      io.to(id).emit('user-joined', socket.id, connections[path]);
    });

    // Send previous messages to the new user
    if (messages[path]) {
      messages[path].forEach((msg) => {
        io.to(socket.id).emit('chat-message', msg.data, msg.sender, msg['socket-id-sender']);
      });
    }

    console.log(path, connections[path]);
  });

  socket.on('signal', (toId, message) => {
    io.to(toId).emit('signal', socket.id, message);
  });

  socket.on('chat-message', (data, sender) => {
    data = sanitizeString(data);
    sender = sanitizeString(sender);

    let roomKey;
    let ok = false;

    for (const [k, v] of Object.entries(connections)) {
      if (v.includes(socket.id)) {
        roomKey = k;
        ok = true;
        break;
      }
    }

    if (ok) {
      if (!messages[roomKey]) messages[roomKey] = [];
      messages[roomKey].push({ sender, data, 'socket-id-sender': socket.id });
      console.log('message', roomKey, ':', sender, data);

      connections[roomKey].forEach((id) => {
        io.to(id).emit('chat-message', data, sender, socket.id);
      });
    }
  });

  socket.on('disconnect', () => {
    const diffTime = Math.abs(timeOnline[socket.id] - new Date());

    for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(connections)))) {
      if (v.includes(socket.id)) {
        const roomKey = k;

        // Notify all users in the room
        connections[roomKey].forEach((id) => {
          io.to(id).emit('user-left', socket.id);
        });

        // Remove socket from room
        connections[roomKey] = connections[roomKey].filter((id) => id !== socket.id);

        console.log(roomKey, socket.id, Math.ceil(diffTime / 1000));

        if (connections[roomKey].length === 0) delete connections[roomKey];
      }
    }
  });
});

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
