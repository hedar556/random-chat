const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingUser = null;

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

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

    // استقبال وإرسال الرسائل
    socket.on('chat message', (msg) => {
        if (socket.partner) {
            socket.partner.emit('chat message', msg);
        }
    });

    // --- الميزة الجديدة: مؤشر الكتابة ---
    socket.on('typing', () => {
        if (socket.partner) socket.partner.emit('typing');
    });

    socket.on('stop typing', () => {
        if (socket.partner) socket.partner.emit('stop typing');
    });
    // ------------------------------------

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

// هذا السطر ليناسب الاستضافة (Render) وجهازك
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`الخادم يعمل بنجاح على المنفذ ${PORT}`);
});
