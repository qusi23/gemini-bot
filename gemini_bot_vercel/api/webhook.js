const { createClient } = require('@supabase/supabase-js');

// ==================== الإعدادات (من Environment Variables) ====================
const BOT_TOKEN   = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== دوال مساعدة ====================

async function sendMessage(chatId, text, replyToMessageId = null) {
  const body = { chat_id: chatId, text };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function loadSettings() {
  const { data } = await supabase.from('stats').select('*').eq('id', 1).single();
  return data || { total_sold: 0, admin_id: null, group_id: null };
}

async function saveSetting(field, value) {
  await supabase.from('stats').update({ [field]: value }).eq('id', 1);
}

function getQuantity(text) {
  text = (text || '').trim().toLowerCase();
  const dual   = ['رابطين', 'لينكين', 'دعوتين', 'لينكان', 'رابطان'];
  const single = ['رابط', 'لينك', 'دعوة', 'link', 'invite'];

  if (dual.some(w => text.includes(w))) return 2;

  if (single.some(w => text.includes(w))) {
    const nums = text.match(/\d+/);
    return nums ? parseInt(nums[0]) : 1;
  }

  return 0;
}

// ==================== المعالج الرئيسي (Webhook Handler) ====================

module.exports = async (req, res) => {
  // رد فوري بـ 200 لتليجرام (مهم جداً)
  res.status(200).send('OK');

  if (req.method !== 'POST' || !req.body?.message) return;

  const message  = req.body.message;
  const chatId   = message.chat.id;
  const userId   = message.from?.id;
  const text     = message.text || '';
  const chatType = message.chat.type;
  const msgId    = message.message_id;

  const settings   = await loadSettings();
  const { total_sold, admin_id, group_id } = settings;
  const isAdmin    = userId == admin_id;

  try {
    // ==================== محادثة خاصة (أوامر الأدمن) ====================
    if (chatType === 'private') {

      if (text === '/myid') {
        await sendMessage(chatId, `الـ ID الخاص بك:\n${userId}`);
      }

      else if (text === '/setadmin') {
        if (!admin_id) {
          await saveSetting('admin_id', userId);
          await sendMessage(chatId,
            `✅ تم تعيينك مسؤولاً وحفظك في قاعدة البيانات!\n` +
            `الـ ID: ${userId}\n\n` +
            `أضف البوت للمجموعة وأرسل /setgroup هناك.`
          );
        } else if (isAdmin) {
          await sendMessage(chatId, '✅ أنت بالفعل المسؤول.');
        } else {
          await sendMessage(chatId, '❌ البوت لديه مسؤول بالفعل.');
        }
      }

      else if (text.startsWith('/add') && isAdmin) {
        const links = text.split(/\s+/).slice(1).filter(Boolean);
        if (!links.length) {
          await sendMessage(chatId, 'اكتب الروابط بعد الأمر:\n/add رابط1 رابط2');
        } else {
          await supabase.from('inventory').insert(links.map(link => ({ link })));
          const { count } = await supabase
            .from('inventory').select('*', { count: 'exact', head: true });
          await sendMessage(chatId,
            `✅ تمت إضافة ${links.length} روابط.\n📦 إجمالي المخزن: ${count} رابط`
          );
        }
      }

      else if (text === '/stock' && isAdmin) {
        const { count: remaining } = await supabase
          .from('inventory').select('*', { count: 'exact', head: true });
        await sendMessage(chatId,
          `📊 إحصائيات البوت:\n\n` +
          `📦 الروابط المتبقية: ${remaining}\n` +
          `✅ إجمالي ما تم بيعه: ${total_sold}\n` +
          `📈 الإجمالي الكلي: ${remaining + total_sold}`
        );
      }
    }

    // ==================== رسائل المجموعات ====================
    if (chatType === 'group' || chatType === 'supergroup') {

      // أمر تفعيل المجموعة (يعمل في أي مجموعة)
      if (text.startsWith('/setgroup') && isAdmin) {
        await saveSetting('group_id', chatId);
        await sendMessage(chatId,
          `✅ تم تفعيل البوت في هذه المجموعة وحفظها!\nالبوت جاهز لاستقبال الطلبات.`
        );
        return;
      }

      // تجاهل أي مجموعة غير المجموعة المحددة
      if (chatId != group_id) return;

      // تجاهل الأوامر داخل المجموعة
      if (text.startsWith('/')) return;

      // معالجة الكلمات المفتاحية
      const quantity = getQuantity(text);
      if (quantity === 0) return;

      const { data: rows } = await supabase
        .from('inventory').select('*').limit(quantity);

      if (rows && rows.length >= quantity) {
        const links     = rows.map(r => r.link);
        const idsToDelete = rows.map(r => r.id);

        await supabase.from('inventory').delete().in('id', idsToDelete);

        const newTotal = (total_sold || 0) + quantity;
        await saveSetting('total_sold', newTotal);

        await sendMessage(chatId, links.join('\n'), msgId);

      } else {
        await sendMessage(chatId, '❌ عذراً، لا توجد روابط متاحة حالياً.', msgId);
        if (admin_id) {
          await sendMessage(admin_id,
            `⚠️ تنبيه: طُلب ${quantity} رابط ولكن المخزن فارغ!\n` +
            `المجموعة: ${message.chat.title}`
          );
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
};
