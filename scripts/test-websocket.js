#!/usr/bin/env node

/**
 * xiaozhi-client WebSocket 连接测试脚本
 *
 * 功能：
 * 1. 连接到 xiaozhi-client 的 WebSocket 服务器 (ws://localhost:9999)
 * 2. 发送 getConfig 请求获取当前配置信息
 * 3. 等待 3 秒钟
 * 4. 发送重启服务的消息给服务端
 * 5. 自动重连机制：
 *    - 发送重启消息后立即开始重连尝试
 *    - 每隔 1 秒尝试重连一次
 *    - 最多尝试 30 次重连（30秒）
 *    - 重连成功后验证连接状态
 *
 * 使用方法：
 * 1. 在项目根目录执行 `xiaozhi start` 启动 WebSocket 服务
 * 2. 在另一个终端窗口运行此脚本：`node test-websocket.js`
 */

import WebSocket from 'ws';

// 配置
const WS_URL = 'ws://localhost:9999';
const WAIT_TIME = 3000;
const RECONNECT_INTERVAL = 1000; // 重连间隔：1秒
const MAX_RECONNECT_ATTEMPTS = 30; // 最大重连次数：30次（30秒）

// 日志工具
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data) {
        console.log(`${prefix} ${message}`, JSON.stringify(data));
    } else {
        console.log(`${prefix} ${message}`);
    }
}

// 重连函数
async function attemptReconnect(originalWs) {
    log('info', '🔄 开始重连流程...');
    let reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
        const reconnectInterval = setInterval(async () => {
            reconnectAttempts++;
            log('info', `🔄 正在尝试重连... 第 ${reconnectAttempts} 次`);

            if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                clearInterval(reconnectInterval);
                log('error', `❌ 重连失败：已达到最大重连次数 (${MAX_RECONNECT_ATTEMPTS})`);
                reject(new Error(`重连失败：已达到最大重连次数 (${MAX_RECONNECT_ATTEMPTS})`));
                return;
            }

            try {
                const newWs = new WebSocket(WS_URL);

                // 设置连接超时
                const connectionTimeout = setTimeout(() => {
                    newWs.close();
                    log('warn', `⚠️  第 ${reconnectAttempts} 次重连超时`);
                }, 5000);

                newWs.on('open', () => {
                    clearTimeout(connectionTimeout);
                    clearInterval(reconnectInterval);
                    log('info', '✅ 重启成功，连接已恢复');

                    // 设置新连接的事件处理
                    setupWebSocketHandlers(newWs);

                    resolve(newWs);
                });

                newWs.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    log('warn', `⚠️  第 ${reconnectAttempts} 次重连失败: ${error.message}`);
                    // 继续尝试，不要reject
                });

                newWs.on('close', () => {
                    clearTimeout(connectionTimeout);
                    // 连接被关闭，继续尝试
                });

            } catch (error) {
                log('warn', `⚠️  第 ${reconnectAttempts} 次重连出现异常: ${error.message}`);
                // 继续尝试，不要reject
            }
        }, RECONNECT_INTERVAL);
    });
}

// WebSocket 事件处理设置函数
function setupWebSocketHandlers(ws) {
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            log('info', '📨 收到消息', { type: message.type });

            if (message.type === 'config') {
                log('info', '📋 收到配置信息');
            } else if (message.type === 'restartStatus') {
                log('info', '🔄 收到重启状态', message.data);
            } else if (message.type === 'restartModeChange') {
                log('info', '🔄 收到重启模式变更通知', message.data);
                if (message.data.message) {
                    log('info', `💡 ${message.data.message}`);
                }
            }
        } catch (error) {
            log('error', '解析消息失败', error.message);
        }
    });

    ws.on('close', (code, reason) => {
        log('info', '🔌 WebSocket 连接已断开', { code, reason: reason.toString() });
    });

    ws.on('error', (error) => {
        log('error', '❌ WebSocket 连接错误', error.message);
    });
}

async function testWebSocket() {
    log('info', '🚀 开始 xiaozhi-client WebSocket 连接测试');
    log('info', `📡 目标服务器: ${WS_URL}`);

    try {
        const ws = new WebSocket(WS_URL);
        let configReceived = false;

        // 连接处理
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('连接超时'));
            }, 10000);

            ws.on('open', () => {
                clearTimeout(timeout);
                log('info', '✅ WebSocket 连接成功');
                resolve();
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                log('error', '❌ WebSocket 连接错误', error.message);
                reject(error);
            });
        });

        // 消息处理
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                log('info', '📨 收到消息', { type: message.type });

                if (message.type === 'config') {
                    log('info', '📋 收到配置信息');
                    configReceived = true;
                } else if (message.type === 'restartStatus') {
                    log('info', '🔄 收到重启状态', message.data);
                } else if (message.type === 'restartModeChange') {
                    log('info', '🔄 收到重启模式变更通知', message.data);
                    if (message.data.message) {
                        log('info', `💡 ${message.data.message}`);
                    }
                }
            } catch (error) {
                log('error', '解析消息失败', error.message);
            }
        });

        ws.on('close', (code, reason) => {
            log('info', '🔌 WebSocket 连接已断开', { code, reason: reason.toString() });
        });

        // 发送 getConfig 请求
        log('info', '🔍 请求获取配置信息...');
        ws.send(JSON.stringify({ type: 'getConfig' }));

        // 等待配置信息
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('获取配置信息超时'));
            }, 5000);

            const checkConfig = () => {
                if (configReceived) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkConfig, 100);
                }
            };

            checkConfig();
        });

        log('info', '✅ 配置信息获取成功');

        // 等待 3 秒
        log('info', `⏳ 等待 ${WAIT_TIME/1000} 秒...`);
        await new Promise(resolve => setTimeout(resolve, WAIT_TIME));

        // 发送重启请求
        log('info', '🔄 发送重启服务请求...');
        ws.send(JSON.stringify({ type: 'restartService' }));

        // 立即开始重连流程
        log('info', '⏳ 等待服务重启...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒让服务有时间重启

        try {
            // 尝试重新建立连接
            const newWs = await attemptReconnect(ws);

            // 重连成功后，可以继续进行其他操作
            log('info', '🎉 重连测试完成，服务已成功重启并重新连接');

            // 可选：发送一个测试消息验证连接
            log('info', '🔍 验证重连后的连接状态...');
            newWs.send(JSON.stringify({ type: 'getConfig' }));

            // 等待一段时间观察连接状态
            await new Promise(resolve => setTimeout(resolve, 3000));

            newWs.close();
            log('info', '✅ 测试完成');
            process.exit(0);

        } catch (reconnectError) {
            log('error', '💥 重连失败', reconnectError.message);
            ws.close();
            process.exit(1);
        }

    } catch (error) {
        log('error', '💥 测试失败', error.message);
        process.exit(1);
    }
}

// 优雅关闭处理
process.on('SIGINT', () => {
    log('info', '🛑 收到中断信号，正在退出...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('info', '🛑 收到终止信号，正在退出...');
    process.exit(0);
});

// 启动测试
testWebSocket();
