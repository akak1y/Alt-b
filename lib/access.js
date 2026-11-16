const { Channel, SpaceMember } = require('../models');

async function getMemberChannel(userId, roomId) {
    const channel = await Channel.findByPk(roomId);

    if (!channel) {
        return { error: 'channel not found', status: 404 };
    }

    const member = await SpaceMember.findOne({
        where: { space_room_id: channel.space_room_id, user_id: userId },
    });

    if (!member) {
        return { error: 'not a member', status: 403 };
    }

    return { channel, member };
}

module.exports = { getMemberChannel };
