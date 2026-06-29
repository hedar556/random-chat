const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const geoip = require('geoip-lite'); // مكتبة معرفة البلد

app.use(express.static('public'));

// قاعدة بيانات مؤقتة للحسابات في الذاكرة (لبداية المشروع)
const usersDB = [];

// طوابير الانتظار المنفصلة
let waitingText = [];
let waitingVideo = [];

// قائمة الكلمات الممنوعة والـ IPs المحظورة
const bannedIPs = [];
const badWords = ['سيء', 'ممنوع']; // يمكنك إضافة ما تريد هنا

io.on('connection', (socket) => {
    // 1. استخراج الـ IP الفعلي للمستخدم
    let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;
    
    // تنظيف الـ IP للعمل المحلي أثناء تجربتك على جهازك
    if (clientIp.substr(0, 7) === "::ffff:") clientIp = clientIp.substr(7);
    if (clientIp === '::1') clientIp = '127.0.0.1';

    // 2. تحديد البلد بناءً على الـ IP
    const geo = geoip.lookup(clientIp);
    socket.country = geo ? geo.country : 'غير معروف';
    socket.clientIp = clientIp;

    // التحقق من الحظر
    if (bannedIPs.includes(clientIp)) {
        socket.emit('banned', 'لقد تم حظرك من الموقع بسبب انتهاك القوانين.');
        socket.disconnect();
        return;
    }

    console.log(`مستخدم متصل: ${socket.id} | البلد: ${socket.country} | IP: ${clientIp}`);

    // --- نظام الحسابات (تسجيل الدخول وإنشاء حساب) ---
    socket.on('register', (data) => {
        const exists = usersDB.find(u => u.username === data.username);
        if (exists) {
            socket.emit('auth_error', 'اسم المستخدم موجود مسبقاً، يرجى اختيار اسم آخر.');
        } else {
            const newUser = { username: data.username, password: data.password, country: socket.country };
            usersDB.push(newUser);
            socket.userAccount = newUser;
            socket.emit('auth_success', { message: 'تم إنشاء الحساب وتسجيل الدخول بنجاح!', user: newUser });
        }
    });

    socket.on('login', (data) => {
        const user = usersDB.find(u => u.username === data.username && u.password === data.password);
        if (user) {
            socket.userAccount = user;
            socket.emit('auth_success', { message: 'تم تسجيل الدخول بنجاح!', user: user });
        } else {
            socket.emit('auth_error', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
        }
    });

    // --- نظام المطابقة الذكي (Matchmaking) ---
    function findPartner(type) {
        let queue = type === 'video' ? waitingVideo : waitingText;

        // تنظيف الطابور من أي مستخدم انقطع اتصاله فجأة
        queue = queue.filter(u => u.connected);

        if (queue.length > 0) {
            // البحث عن شخص ليس هو نفس الشخص الذي تخطيناه للتو
            let partnerIndex = queue.findIndex(u => u.id !== socket.lastPartnerId);
            
            if (partnerIndex !== -1) {
                // سحب الشريك المناسب من الطابور
                let partner = queue.splice(partnerIndex, 1)[0];

                socket.partner = partner;
                partner.partner = socket;

                // حفظ معرفات بعضنا البعض لمنع التكرار الفوري عند التخطي
                socket.lastPartnerId = partner.id;
                partner.lastPartnerId = socket.id;

                // تجهيز بيانات الطرفين لإرسالها للواجهة (البلد والاسم)
                const myData = { 
                    country: socket.country, 
                    username: socket.userAccount ? socket.userAccount.username : 'غريب' 
                };
                const partnerData = { 
                    country: partner.country, 
                    username: partner.userAccount ? partner.userAccount.username : 'غريب' 
                };

                if (type === 'video') {
                    socket.emit('match', { message: `تم الاتصال بشخص من [${partnerData.country}]`, partnerData: partnerData, isCaller: true });
                    partner.emit('match', { message: `تم الاتصال بشخص من [${myData.country}]`, partnerData: myData, isCaller: false });
                } else {
                    socket.emit('chat start', `تتحدث الآن مع شخص من [${partnerData.country}]`);
                    partner.emit('chat start', `تتحدث الآن مع شخص من [${myData.country}]`);
                }
            } else {
                // إذا كان الشخص الوحيد المتاح هو الشخص الذي تخطيته للتو، انتظرا شخصاً جديداً
                queue.push(socket);
                socket.emit('waiting', 'جاري البحث عن شخص جديد...');
            }
        } else {
            // لا يوجد أحد في الطابور
            queue.push(socket);
            socket.emit('waiting', 'جاري البحث عن شخص...');
        }

        // تحديث الطوابير الأصلية
        if (type === 'video') waitingVideo = queue;
        else waitingText = queue;
    }

    // بدء الدردشة
    socket.on('start', (type) => {
        socket.chatType = type;
        findPartner(type);
    });

    // --- زر التخطي (Next) ---
    socket.on('next', () => {
        if (socket.partner) {
            // إرسال رسالة للشريك أنك غادرت
            socket.partner.emit('partner disconnected', 'الشخص الآخر قام بالتخطي.');
            socket.partner.partner = null;
            socket.partner = null;
        }
        
        // إزالة المستخدم من أي طابور إن وجد لتجنب الأخطاء
        waitingText = waitingText.filter(u => u.id !== socket.id);
        waitingVideo = waitingVideo.filter(u => u.id !== socket.id);
        
        socket.emit('system clear');
        
        if (socket.chatType) {
            findPartner(socket.chatType); // البحث الفوري عن شخص جديد
        }
    });

    // --- المراسلة النصية ---
    socket.on('chat message', (msg) => {
        let isBadWord = badWords.some(word => msg.includes(word));
        if (isBadWord) {
            socket.emit('system warning', 'تم حجب رسالتك لاحتوائها على ألفاظ غير لائقة.');
            return;
        }
        if (socket.partner) {
            socket.partner.emit('chat message', msg);
        }
    });

    // --- تبادل إشارات الفيديو (WebRTC) ---
    socket.on('offer', (offer) => { if (socket.partner) socket.partner.emit('offer', offer); });
    socket.on('answer', (answer) => { if (socket.partner) socket.partner.emit('answer', answer); });
    socket.on('ice-candidate', (candidate) => { if (socket.partner) socket.partner.emit('ice-candidate', candidate); });

    // --- نظام التبليغ والحظر ---
    socket.on('report', () => {
        if (socket.partner) {
            bannedIPs.push(socket.partner.clientIp); // حظر الـ IP
            socket.partner.emit('banned', 'تم الإبلاغ عنك وحظرك من الموقع نهائياً.');
            socket.partner.disconnect();
            socket.emit('system warning', 'تم حظر الشخص بنجاح. شكراً لتبليغك.');
            socket.partner = null;
        }
    });

    // --- الانقطاع المفاجئ (إغلاق المتصفح) ---
    socket.on('disconnect', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر الموقع.');
            socket.partner.partner = null;
        }
        waitingText = waitingText.filter(u => u.id !== socket.id);
        waitingVideo = waitingVideo.filter(u => u.id !== socket.id);
        console.log(`مستخدم غادر: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`الخادم الشامل والمطور يعمل بنجاح على المنفذ ${PORT}`);
});
