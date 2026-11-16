const { DataTypes } = require('sequelize');
const sequelize = require('./db');

const User = sequelize.define(
    'user',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        login: { type: DataTypes.STRING(32), allowNull: false, unique: true },
        matrix_user_id: { type: DataTypes.STRING(128), allowNull: false },
        matrix_token: { type: DataTypes.TEXT, allowNull: false },
        // чёрный ящик настроек: тема, фильтры, макросы, анимации, email, phone
        // и любой будущий кастом. бэк хранит и отдаёт как есть, не цензорит.
        settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
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
        room_id: { type: DataTypes.STRING(128), primaryKey: true },
        name: { type: DataTypes.STRING(64), allowNull: false },
        owner_id: { type: DataTypes.INTEGER, allowNull: false },
        // кастом сервера: цвета, логотип, правила — что захочет владелец.
        settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
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

const Channel = sequelize.define(
    'channel',
    {
        room_id: { type: DataTypes.STRING(128), primaryKey: true },
        space_room_id: { type: DataTypes.STRING(128), allowNull: false },
        name: { type: DataTypes.STRING(64), allowNull: false },
        // кастом рума/канала.
        settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
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

const SpaceMember = sequelize.define(
    'space_member',
    {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        space_room_id: { type: DataTypes.STRING(128), allowNull: false },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
        role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'member' },
    },
    {
        tableName: 'space_members',
        timestamps: false,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        indexes: [{ unique: true, fields: ['space_room_id', 'user_id'] }],
    },
);

module.exports = { User, Space, Channel, SpaceMember };
