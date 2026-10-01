const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const User = sequelize.define(
    'user',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        login: { type: DataTypes.STRING(32), allowNull: false, unique: true },
        password_hash: { type: DataTypes.STRING(255), allowNull: false },
    },
    {
        tableName: 'users',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
);

const Space = sequelize.define(
    'space',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        name: { type: DataTypes.STRING(64), allowNull: false },
        owner_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
        },
    },
    {
        tableName: 'spaces',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
);

const SpaceMember = sequelize.define(
    'space_member',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        space_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'spaces', key: 'id' },
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
        },
        role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'member' },
    },
    {
        tableName: 'space_members',
        timestamps: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        indexes: [{ unique: true, fields: ['space_id', 'user_id'] }],
    },
);

const Channel = sequelize.define(
    'channel',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        space_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'spaces', key: 'id' },
        },
        name: { type: DataTypes.STRING(64), allowNull: false },
        type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'text' },
    },
    {
        tableName: 'channels',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
);

const Message = sequelize.define(
    'message',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
        },
        channel_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'channels', key: 'id' },
        },
        content: { type: DataTypes.TEXT, allowNull: false },
    },
    {
        tableName: 'messages',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
);

User.hasMany(Message, { foreignKey: 'user_id' });
Message.belongsTo(User, { foreignKey: 'user_id' });

Space.hasMany(Channel, { foreignKey: 'space_id' });
Channel.belongsTo(Space, { foreignKey: 'space_id' });

Space.hasMany(SpaceMember, { foreignKey: 'space_id' });
SpaceMember.belongsTo(Space, { foreignKey: 'space_id' });
SpaceMember.belongsTo(User, { foreignKey: 'user_id' });

Channel.hasMany(Message, { foreignKey: 'channel_id' });
Message.belongsTo(Channel, { foreignKey: 'channel_id' });

module.exports = { User, Space, SpaceMember, Channel, Message };
