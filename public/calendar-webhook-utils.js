// 1-Click Calendar Sync (.ics & Google Calendar) and Discord Webhook Utilities

export function buildGoogleCalendarUrl(meetup, roomCode) {
    if (!meetup || !meetup.datetime) return '#';
    const startDate = new Date(meetup.datetime);
    if (isNaN(startDate.getTime())) return '#';

    // Assume standard 3-hour Commander pod session
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toUtcStr = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

    const title = encodeURIComponent(`⚔️ MTG Commander Battle - Pod ${roomCode}`);
    const dates = `${toUtcStr(startDate)}/${toUtcStr(endDate)}`;
    const details = encodeURIComponent(
        `🏆 Format: ${meetup.format || 'Commander'}\n` +
        `🎁 Prize: ${meetup.prize || 'Glory'}\n` +
        `🏰 Playgroup Lobby: ${window.location.origin}/?room=${roomCode}\n\n` +
        `Get your 100-card deck sealed and ready for battle!`
    );
    const location = encodeURIComponent(`Commander Challenge Lobby (${window.location.origin}/?room=${roomCode})`);

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
}

export function downloadIcsFile(meetup, roomCode) {
    if (!meetup || !meetup.datetime) return;
    const startDate = new Date(meetup.datetime);
    if (isNaN(startDate.getTime())) return;

    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toIcsStr = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    const nowStr = toIcsStr(new Date());

    const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Commander Challenge//MTG Draft Lobby//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:cmdr-battle-${roomCode}-${startDate.getTime()}@commander-challenge`,
        `DTSTAMP:${nowStr}`,
        `DTSTART:${toIcsStr(startDate)}`,
        `DTEND:${toIcsStr(endDate)}`,
        `SUMMARY:⚔️ MTG Commander Battle - Pod ${roomCode}`,
        `DESCRIPTION:Format: ${meetup.format || 'Commander'}\\nPrize: ${meetup.prize || 'Glory'}\\nLobby: ${window.location.origin}/?room=${roomCode}`,
        `LOCATION:Commander Challenge Pod ${roomCode}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `commander-battle-${roomCode}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export async function testDiscordWebhook(webhookUrl, roomCode) {
    if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        throw new Error('Invalid Discord Webhook URL. Must start with https://discord.com/api/webhooks/');
    }

    const payload = {
        username: "Commander Archives",
        avatar_url: "https://commander-challenge.web.app/icon-512.png",
        embeds: [
            {
                title: `⚔️ Commander Challenge Notification Test`,
                description: `Playgroup **${roomCode || 'LOBBY'}** is successfully connected to this Discord channel!`,
                color: 13938487, // Gold (#d4af37)
                fields: [
                    { name: "🏰 Lobby Status", value: "Active & Connected", inline: true },
                    { name: "🔗 App URL", value: `[Join Lobby](${window.location.origin}/?room=${roomCode || ''})`, inline: true }
                ],
                footer: { text: "Commander Challenge Draft System" },
                timestamp: new Date().toISOString()
            }
        ]
    };

    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`Discord responded with status ${res.status}: ${res.statusText}`);
    }
    return true;
}
