const write = (level, msg, ctx) => {
    const line = { ts: new Date().toISOString(), level, msg };
    if (ctx !== undefined) {
        line.ctx = ctx instanceof Error ? { message: ctx.message, stack: ctx.stack } : ctx;
    }
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](JSON.stringify(line));
};

module.exports = {
    info: (msg, ctx) => write('info', msg, ctx),
    warn: (msg, ctx) => write('warn', msg, ctx),
    error: (msg, ctx) => write('error', msg, ctx),
};
