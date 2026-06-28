const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// قائمة المستخدمين المنتظرين
let waitingUsers = [];

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // دالة البحث عن شريك
    function findPartner(userSocket) {
        let partnerIndex = -1;

        // 1. محاولة البحث عن شخص لديه اهتمامات مشتركة
        if (userSocket.interests && userSocket.interests.length > 0) {
            partnerIndex = waitingUsers.findIndex(u => 
                u.interests && u.interests.some(interest => userSocket.interests.includes(interest))
            );
        }

        // 2. إذا لم يجد (أو لم يكتب اهتمامات)، ابحث عن أي شخص ليس لديه اهتمامات
        if (partnerIndex === -1) {
            partnerIndex = waitingUsers.findIndex(u => !u.interests || u.interests.length === 0);
        }

        // 3. إذا كان هناك أي شخص في الانتظار كخيار أخير
        if (partnerIndex === -1 && waitingUsers.length > 0) {
            partnerIndex = 0; 
        }

        if (partnerIndex !== -1) {
            let partner = waitingUsers.splice(partnerIndex, 1)[0]; // سحبه من الطابور
            
            userSocket.partner = partner;
            partner.partner = userSocket;

            // التحقق من وجود اهتمامات مشتركة لإرسال رسالة مخصصة
            let common = [];
            if (userSocket.interests && partner.interests) {
                common = userSocket.interests.filter(i => partner.interests.includes(i));
            }

            let msg = common.length > 0 
                ? `تم العثور على شخص يشاركك الاهتمام بـ: ${common.join('، ')}` 
                : 'تم العثور على شخص غريب، يمكنك التحدث الآن!';

            userSocket.emit('chat start', msg);
            partner.emit('chat start', msg);
        } else {
            // وضعه في طابور الانتظار
            waitingUsers.push(userSocket);
            userSocket.emit('waiting', 'جاري البحث عن شخص للدردشة...');
        }
    }

    // بدء المحادثة مع الاهتمامات
    socket.on('start chat', (interests) => {
        // تحويل النص إلى مصفوفة اهتمامات
        socket.interests = interests.split(',').map(i => i.trim()).filter(i => i !== "");
        findPartner(socket);
    });

    // تخطي (البحث عن شخص جديد)
    socket.on('next', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر المحادثة.');
            socket.partner.partner = null;
            socket.partner = null;
        }
        // إزالة من طابور الانتظار إن كان موجوداً
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        
        socket.emit('system clear'); // تنظيف الشاشة
        findPartner(socket);
    });

    socket.on('chat message', (msg) => {
        if (socket.partner) socket.partner.emit('chat message', msg);
    });

    socket.on('typing', () => {
        if (socket.partner) socket.partner.emit('typing');
    });

    socket.on('stop typing', () => {
        if (socket.partner) socket.partner.emit('stop typing');
    });

    socket.on('disconnect', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر المحادثة.');
            socket.partner.partner = null;
        }
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`الخادم يعمل بنجاح على المنفذ ${PORT}`);
});
