const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Spelstate
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Spelare ansluten:', socket.id);

  // Skapa rum
  socket.on('create-room', (playerName) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      players: [{ id: socket.id, name: playerName, isHost: true }],
      gameState: 'waiting', // waiting, drawing, guessing, results
      currentRound: 0,
      maxRounds: 5,
      drawings: new Map(), // playerId -> [{drawingData, word}]
      timer: null
    };
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('players-updated', room.players);
  });

  // Gå med i rum
  socket.on('join-room', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) {
      socket.emit('error', 'Rummet finns inte');
      return;
    }
    if (room.players.length >= 8) {
      socket.emit('error', 'Rummet är fullt (max 8 spelare)');
      return;
    }
    
    room.players.push({ id: socket.id, name: playerName, isHost: false });
    socket.join(roomCode);
    socket.emit('joined-room', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('players-updated', room.players);
  });

  // Starta spel
  socket.on('start-game', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.players[0].id !== socket.id) return;
    
    room.gameState = 'drawing';
    room.currentRound = 1;
    
    // Tilldela ord till varje spelare
    const words = ['katt', 'hund', 'cykel', 'flygplan', 'pizza', 'regnbåge', 'robot', 'enhörning'];
    room.players.forEach((player, index) => {
      player.word = words[index % words.length];
      player.drawings = [];
    });
    
    io.to(roomCode).emit('game-started', {
      round: 1,
      word: room.players.find(p => p.id === socket.id).word
    });
    
    // Starta timer (60 sekunder per runda)
    startRoundTimer(roomCode);
  });

  // Ta emot ritning
  socket.on('submit-drawing', ({ roomCode, drawingData }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.drawings.push({
        data: drawingData,
        round: room.currentRound,
        word: player.word
      });
    }
    
    // Kolla om alla har skickat in
    const allSubmitted = room.players.every(p => 
      p.drawings.filter(d => d.round === room.currentRound).length > 0
    );
    
    if (allSubmitted) {
      endRound(roomCode);
    }
  });

  // Gissa ord
  socket.on('submit-guess', ({ roomCode, guess }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Hantera gissningslogik här
    // I Gartic Phone: nästa spelare ser föregående ritning och gissar
  });

  // Koppla från
  socket.on('disconnect', () => {
    rooms.forEach((room, code) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit('players-updated', room.players);
        }
      }
    });
  });
});

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function startRoundTimer(roomCode) {
  const room = rooms.get(roomCode);
  let timeLeft = 60;
  
  room.timer = setInterval(() => {
    timeLeft--;
    io.to(roomCode).emit('timer-update', timeLeft);
    
    if (timeLeft <= 0) {
      clearInterval(room.timer);
      endRound(roomCode);
    }
  }, 1000);
}

function endRound(roomCode) {
  const room = rooms.get(roomCode);
  clearInterval(room.timer);
  
  // Rotera ritningar (Gartic Phone-stil)
  // Spelare 1s ritning går till Spelare 2, som gissar, sedan ritar Spelare 3 baserat på gissningen, osv.
  
  room.currentRound++;
  
  if (room.currentRound > room.maxRounds) {
    io.to(roomCode).emit('game-ended', room.players);
    room.gameState = 'results';
  } else {
    room.gameState = 'guessing';
    io.to(roomCode).emit('round-ended', { nextRound: room.currentRound });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server körs på port ${PORT}`);
});
