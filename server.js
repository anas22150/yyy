const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// قائمة البطاقات (18 بطاقة متنوعة)
const CARDS = [
    { id: 1, name: "أسد", category: "حيوان" },
    { id: 2, name: "فيل", category: "حيوان" },
    { id: 3, name: "زرافة", category: "حيوان" },
    { id: 4, name: "سمكة", category: "حيوان" },
    { id: 5, name: "قطة", category: "حيوان" },
    { id: 6, name: "كلب", category: "حيوان" },
    { id: 7, name: "سيارة", category: "شيء" },
    { id: 8, name: "طائرة", category: "شيء" },
    { id: 9, name: "تفاحة", category: "فاكهة" },
    { id: 10, name: "موز", category: "فاكهة" },
    { id: 11, name: "ميسي", category: "شخصية", hint: "لاعب كرة قدم" },
    { id: 12, name: "أينشتاين", category: "شخصية", hint: "عالم فيزياء" },
    { id: 13, name: "سنو وايت", category: "شخصية" },
    { id: 14, name: "باتمان", category: "شخصية" },
    { id: 15, name: "سبونج بوب", category: "شخصية كرتونية" },
    { id: 16, name: "ويني الدبدوب", category: "شخصية" },
    { id: 17, name: "كرة القدم", category: "رياضة" },
    { id: 18, name: "تلفزيون", category: "جهاز" }
];

const rooms = new Map(); // roomId -> { players, status, currentTurn, ... }

// خدمة الملفات الثابتة من الجذر (حيث يوجد server.js)
app.use(express.static(__dirname));

// تقديم الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    let currentRoom = null;
    let playerName = null;

    socket.on('createRoom', (data) => {
        const roomId = data.roomId || Math.random().toString(36).substring(2, 6).toUpperCase();
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                players: new Map(),
                status: 'waiting',
                currentTurn: null,
                questionHistory: []
            });
        }
        const room = rooms.get(roomId);
        if (room.players.size >= 6) {
            socket.emit('error', 'الغرفة ممتلئة');
            return;
        }
        currentRoom = roomId;
        playerName = data.playerName || 'Player' + Math.floor(Math.random()*1000);
        const playerData = {
            id: socket.id,
            name: playerName,
            card: null,
            hasGuessed: false,
            score: 0
        };
        room.players.set(socket.id, playerData);
        socket.join(roomId);
        socket.emit('roomJoined', {
            roomId,
            players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })),
            status: room.status
        });
        io.to(roomId).emit('playersUpdate', Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })));
    });

    socket.on('joinRoom', (data) => {
        const roomId = data.roomId;
        if (!rooms.has(roomId)) {
            socket.emit('error', 'الغرفة غير موجودة');
            return;
        }
        const room = rooms.get(roomId);
        if (room.players.size >= 6) {
            socket.emit('error', 'الغرفة ممتلئة');
            return;
        }
        if (room.status !== 'waiting') {
            socket.emit('error', 'اللعبة بدأت بالفعل');
            return;
        }
        currentRoom = roomId;
        playerName = data.playerName || 'Player' + Math.floor(Math.random()*1000);
        const playerData = {
            id: socket.id,
            name: playerName,
            card: null,
            hasGuessed: false,
            score: 0
        };
        room.players.set(socket.id, playerData);
        socket.join(roomId);
        socket.emit('roomJoined', {
            roomId,
            players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })),
            status: room.status
        });
        io.to(roomId).emit('playersUpdate', Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })));
    });

    socket.on('startGame', () => {
        const room = rooms.get(currentRoom);
        if (!room) return;
        if (room.players.size < 2) {
            socket.emit('error', 'تحتاج إلى لاعبين على الأقل');
            return;
        }
        const playersArray = Array.from(room.players.values());
        const shuffledCards = [...CARDS];
        for (let i = shuffledCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledCards[i], shuffledCards[j]] = [shuffledCards[j], shuffledCards[i]];
        }
        for (let i = 0; i < playersArray.length; i++) {
            const card = shuffledCards[i % shuffledCards.length];
            playersArray[i].card = card;
            io.to(playersArray[i].id).emit('yourCard', card);
        }
        room.status = 'playing';
        const randomIndex = Math.floor(Math.random() * playersArray.length);
        room.currentTurn = playersArray[randomIndex].id;
        io.to(currentRoom).emit('gameStarted', {
            currentTurn: room.currentTurn,
            players: playersArray.map(p => ({ id: p.id, name: p.name, score: p.score }))
        });
    });

    socket.on('askQuestion', (data) => {
        const room = rooms.get(currentRoom);
        if (!room) return;
        if (room.status !== 'playing') return;
        if (room.currentTurn !== socket.id) {
            socket.emit('error', 'ليس دورك الآن');
            return;
        }
        io.to(currentRoom).emit('newQuestion', { from: socket.id, question: data.question, time: Date.now() });
    });

    socket.on('answerQuestion', (data) => {
        const room = rooms.get(currentRoom);
        if (!room) return;
        if (room.status !== 'playing') return;
        if (socket.id === data.questionerId) {
            socket.emit('error', 'لا يمكنك الإجابة على سؤالك بنفسك');
            return;
        }
        io.to(currentRoom).emit('answerReceived', { from: socket.id, to: data.questionerId, answer: data.answer });
        const players = Array.from(room.players.values());
        const currentIndex = players.findIndex(p => p.id === room.currentTurn);
        const nextIndex = (currentIndex + 1) % players.length;
        room.currentTurn = players[nextIndex].id;
        io.to(currentRoom).emit('turnChanged', { currentTurn: room.currentTurn });
    });

    socket.on('guess', (data) => {
        const room = rooms.get(currentRoom);
        if (!room) return;
        if (room.status !== 'playing') return;
        if (room.currentTurn !== socket.id) {
            socket.emit('error', 'ليس دورك الآن');
            return;
        }
        const player = room.players.get(socket.id);
        if (!player.card) return;
        if (player.card.name.toLowerCase() === data.guess.toLowerCase()) {
            player.score += 1;
            player.hasGuessed = true;
            io.to(currentRoom).emit('correctGuess', { playerId: socket.id, playerName: player.name, card: player.card.name });
            io.to(currentRoom).emit('gameOver', { winner: player.name, card: player.card.name });
            setTimeout(() => resetGame(room, currentRoom), 5000);
        } else {
            io.to(currentRoom).emit('wrongGuess', { playerId: socket.id, guess: data.guess });
            const players = Array.from(room.players.values());
            const currentIndex = players.findIndex(p => p.id === room.currentTurn);
            const nextIndex = (currentIndex + 1) % players.length;
            room.currentTurn = players[nextIndex].id;
            io.to(currentRoom).emit('turnChanged', { currentTurn: room.currentTurn });
        }
    });

    function resetGame(room, roomId) {
        const playersArray = Array.from(room.players.values());
        const shuffledCards = [...CARDS];
        for (let i = shuffledCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledCards[i], shuffledCards[j]] = [shuffledCards[j], shuffledCards[i]];
        }
        for (let i = 0; i < playersArray.length; i++) {
            playersArray[i].card = shuffledCards[i % shuffledCards.length];
            playersArray[i].hasGuessed = false;
            io.to(playersArray[i].id).emit('yourCard', playersArray[i].card);
        }
        room.currentTurn = playersArray[0].id;
        room.status = 'playing';
        io.to(roomId).emit('gameReset', {
            currentTurn: room.currentTurn,
            players: playersArray.map(p => ({ id: p.id, name: p.name, score: p.score }))
        });
    }

    socket.on('disconnect', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.players.delete(socket.id);
            io.to(currentRoom).emit('playersUpdate', Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })));
            if (room.players.size === 0) {
                rooms.delete(currentRoom);
            } else if (room.currentTurn === socket.id) {
                const remaining = Array.from(room.players.values());
                room.currentTurn = remaining[0].id;
                io.to(currentRoom).emit('turnChanged', { currentTurn: room.currentTurn });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ خادم Who I Am يعمل على المنفذ ${PORT}`));