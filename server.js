const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingUsers = [];
let bannedIPs = []; // قائمة عناوين الـ IP المحظورة

// قائمة الكلمات الممنوعة (يمكنك إضافة المزيد داخل الأقواس)
const badWords = ['كلمة1', 'كلمة2', 'سيء'];

io.on('connection', (socket) => {
    // الحصول على عنوان الـ IP الحقيقي للمستخدم (مهم جداً في الاستضافات مثل Render)
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;

    // 1. التحقق مما إذا كان المستخدم محظوراً قبل السماح له بالدخول
    if (bannedIPs.includes(clientIp)) {
        socket.emit('banned', 'لقد تم حظرك من استخدام الموقع بسبب انتهاك القوانين.');
        socket.disconnect(); // قطع الاتصال فوراً
        return;
    }

    console.log('مستخدم متصل:', socket.id, 'IP:', clientIp);

    // دالة البحث عن شريك (مع الاهتمامات)
    function findPartner(userSocket) {
        let partnerIndex = -1;

        if (userSocket.interests && userSocket.interests.length > 0) {
            partnerIndex = waitingUsers.findIndex(u => 
                u.interests && u.interests.some(interest => userSocket.interests.includes(interest))
            );
        }

        if (partnerIndex === -1) {
            partnerIndex = waitingUsers.findIndex(u => !u.interests || u.interests.length === 0);
        }

        if (partnerIndex === -1 && waitingUsers.length > 0) {
            partnerIndex = 0; 
        }

        if (partnerIndex !== -1) {
            let partner = waitingUsers.splice(partnerIndex, 1)[0];
            
            userSocket.partner = partner;
            partner.partner = userSocket;

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
            waitingUsers.push(userSocket);
            userSocket.emit('waiting', 'جاري البحث عن شخص للدردشة...');
        }
    }

    socket.on('start chat', (interests) => {
        socket.interests = interests.split(',').map(i => i.trim()).filter(i => i !== "");
        findPartner(socket);
    });

    socket.on('next', () => {
        if (socket.partner) {
            socket.partner.emit('partner disconnected', 'الشخص الآخر غادر المحادثة.');
            socket.partner.partner = null;
            socket.partner = null;
        }
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        socket.emit('system clear');
        findPartner(socket);
    });

    socket.on('chat message', (msg) => {
        // 2. التحقق من الكلمات المسيئة قبل إرسال الرسالة
        let isBadWord = badWords.some(word => msg.includes(word));
        if (isBadWord) {
            socket.emit('system warning', 'تم حجب رسالتك لأنها تحتوي على كلمات غير لائقة.');
            return; // إيقاف إرسال الرسالة للطرف الآخر
        }

        if (socket.partner) socket.partner.emit('chat message', msg);
    });

    // 3. نظام التبليغ والحظر
    socket.on('report', () => {
        if (socket.partner) {
            // جلب الـ IP الخاص بالشخص المسيء
            const partnerIp = socket.partner.handshake.headers['x-forwarded-for'] || socket.partner.request.connection.remoteAddress;
            
            // إضافته لقائمة الحظر
            bannedIPs.push(partnerIp);

            // إرسال رسالة طرد للمسيء وقطع اتصاله
            socket.partner.emit('banned', 'تم الإبلاغ عنك وحظرك من الموقع.');
            socket.partner.disconnect();

            // إبلاغك بنجاح العملية
            socket.emit('system warning', 'تم طرد هذا الشخص وحظره بنجاح. شكراً لتبليغك.');
            socket.partner = null;
        }
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
