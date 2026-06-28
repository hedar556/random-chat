const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// تحديد المجلد الذي يحتوي على واجهة الموقع
app.use(express.static('public'));

let waitingUser = null;

io.on('connection', (socket) => {
    console.log('مستخدم جديد متصل:', socket.id);

    // نظام البحث عن شريك (Matchmaking)
    if (waitingUser) {
        socket.partner = waitingUser;
        waitingUser.partner = socket;
        waitingUser = null;

        socket.emit('chat start', 'تم العثور على شخص غريب، يمكنك التحدث الآن!');
        socket.partner.emit('chat start', 'تم العثور على شخص غريب، يمكنك التحدث الآن!');
    } else {
        waitingUser = socket;
        socket.emit('waiting', 'جاري البحث عن شخص للدردشة...');
    }

    socket.on('chat message', (msg) => {
        if (socket.partner) {
            socket.partner.emit('chat message', msg);
        }
    });

    socket.on('disconnect', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر المحادثة.');
            socket.partner.partner = null;
        }
        if (waitingUser === socket) {
            waitingUser = null;
        }
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`الخادم يعمل بنجاح على http://localhost:${PORT}`);
});