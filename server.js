const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// تحديد المجلد الذي يحتوي على واجهة الموقع
app.use(express.static('public'));

// إنشاء طابورين منفصلين: واحد للنص والآخر للفيديو
let waitingText = [];
let waitingVideo = [];

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // دالة للبحث عن شريك بناءً على اختيار المستخدم (نص أو فيديو)
    function findPartner(type) {
        let queue = type === 'video' ? waitingVideo : waitingText;

        if (queue.length > 0) {
            let partner = queue.shift(); // سحب أول شخص من قائمة الانتظار
            socket.partner = partner;
            partner.partner = socket;

            if (type === 'video') {
                // إرسال إشعار المطابقة مع تحديد من سيقوم بإنشاء الاتصال (WebRTC)
                socket.emit('match', { message: 'تم العثور على شخص، جاري فتح الكاميرا...', isCaller: true });
                partner.emit('match', { message: 'تم العثور على شخص، جاري فتح الكاميرا...', isCaller: false });
            } else {
                // إشعار الدردشة النصية العادية
                socket.emit('chat start', 'تم العثور على شخص غريب، يمكنك التحدث الآن!');
                partner.emit('chat start', 'تم العثور على شخص غريب، يمكنك التحدث الآن!');
            }
        } else {
            // إذا لم يجد أحداً، يضعه في القائمة المناسبة
            queue.push(socket);
            socket.emit('waiting', 'جاري البحث عن شخص...');
        }
    }

    // 1. استقبال طلب بدء الدردشة من الواجهة
    socket.on('start', (type) => {
        socket.chatType = type; // حفظ نوع الدردشة الخاص بهذا المستخدم
        findPartner(type);
    });

    // 2. زر التخطي (Next)
    socket.on('next', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر.');
            socket.partner.partner = null;
            socket.partner = null;
        }
        
        // إزالة المستخدم من أي طابور لتجنب الأخطاء
        waitingText = waitingText.filter(u => u.id !== socket.id);
        waitingVideo = waitingVideo.filter(u => u.id !== socket.id);
        
        socket.emit('system clear');
        
        // البحث عن شخص جديد بنفس النوع الذي اختاره مسبقاً
        if (socket.chatType) {
            findPartner(socket.chatType);
        }
    });

    // 3. إرسال واستقبال الرسائل النصية
    socket.on('chat message', (msg) => {
        if (socket.partner) {
            socket.partner.emit('chat message', msg);
        }
    });

    // 4. أحداث تبادل إشارات الفيديو (WebRTC)
    socket.on('offer', (offer) => {
        if (socket.partner) socket.partner.emit('offer', offer);
    });

    socket.on('answer', (answer) => {
        if (socket.partner) socket.partner.emit('answer', answer);
    });

    socket.on('ice-candidate', (candidate) => {
        if (socket.partner) socket.partner.emit('ice-candidate', candidate);
    });

    // 5. الانقطاع المفاجئ عن الموقع
    socket.on('disconnect', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر.');
            socket.partner.partner = null;
        }
        waitingText = waitingText.filter(u => u.id !== socket.id);
        waitingVideo = waitingVideo.filter(u => u.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`الخادم الشامل يعمل بنجاح على المنفذ ${PORT}`);
});
