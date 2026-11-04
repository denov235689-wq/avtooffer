
require("dotenv").config();

const API = `https://paxta.online/bot${process.env.BOT_TOKEN}`;

let offset = 0;
const users = new Map();

async function request(method, data = {}) {
    const response = await fetch(`${API}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });

    return response.json();
}

async function send(chatId, message) {
    return request("sendMessage", {
        chat_id: chatId,
        text: message
    });
}

function randomName() {
    return "RANDOM" + Math.floor(10000 + Math.random() * 90000);
}

function randomUsername() {
    return "random_" + Math.random().toString(36).slice(2, 12);
}

function randomPassword() {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let password = "";

    for (let i = 0; i < 12; i++) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }

    return password;
}

function generateAccounts(count) {
    const accounts = [];

    for (let i = 0; i < count; i++) {
        accounts.push({
            name: randomName(),
            username: randomUsername(),
            password: randomPassword()
        });
    }

    return accounts;
}

async function handleMessage(message) {
    if (!message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start") {
        users.set(chatId, { step: "password" });

        return send(
            chatId,
            "🔐 PAxtaGRAM ADMIN BOT\n\nAdmin parolini yuboring:"
        );
    }

    const user = users.get(chatId);

    if (!user) return;

    if (user.step === "password") {
        if (text !== process.env.ADMIN_PASSWORD) {
            return send(chatId, "❌ Parol noto‘g‘ri!");
        }

        user.step = "count";

        return send(
            chatId,
            "✅ Admin tasdiqlandi!\n\nNechta akkaunt yaratish kerak?\nMasalan: 10"
        );
    }

    if (user.step === "count") {
        const count = Number(text);

        if (!Number.isInteger(count) || count < 1 || count > 100) {
            return send(chatId, "❌ 1 dan 100 gacha son kiriting.");
        }

        user.step = "done";

        const accounts = generateAccounts(count);

        let result = `🎉 RANDOM ACCOUNT GENERATOR\n`;
        result += `Jami: ${count} ta\n\n`;

        accounts.forEach((account, index) => {
            result += `👤 AKKAUNT ${index + 1}\n`;
            result += `Ism: ${account.name}\n`;
            result += `Login: ${account.username}\n`;
            result += `Parol: ${account.password}\n`;
            result += `━━━━━━━━━━━━━━\n`;
        });

        result += "\n⚠️ Bu ma'lumotlar generator tomonidan yaratildi. Saytda ro‘yxatdan o‘tmagan.";

        return send(chatId, result);
    }

    if (text === "/cancel") {
        users.delete(chatId);
        return send(chatId, "Bekor qilindi. /start bosing.");
    }
}

async function main() {
    console.log("PaxtaGram bot ishga tushmoqda...");

    while (true) {
        try {
            const data = await request("getUpdates", {
                offset,
                timeout: 25
            });

            if (!data.ok || !Array.isArray(data.result)) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            for (const update of data.result) {
                offset = update.update_id + 1;

                if (update.message) {
                    await handleMessage(update.message);
                }
            }
        } catch (error) {
            console.log("Xatolik:", error.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

if (!process.env.BOT_TOKEN || !process.env.ADMIN_PASSWORD) {
    console.log(".env faylini tekshiring!");
    process.exit(1);
}

main();
