const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const winston = require('winston');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const cron = require('node-cron');
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

// Configuration
const CONFIG = {
    PORT: process.env.PORT || 3008,
    CORE_API_URL: process.env.CORE_API_URL || 'http://localhost:4001',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'corebridge-license-key-2024',
    JWT_SECRET: process.env.JWT_SECRET || 'corebridge-jwt-secret-2024',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || 5432,
    DB_NAME: process.env.DB_NAME || 'corebridge_licensing',
    DB_USER: process.env.DB_USER || 'corebridge',
    DB_PASS: process.env.DB_PASS || 'corebridge123',
    SMTP_HOST: process.env.SMTP_HOST || 'localhost',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    COMPANY_NAME: 'CoreBridge Technologies',
    LICENSE_VALIDITY_DAYS: {
        '1-year': 365,
        '3-year': 1095,
        '5-year': 1825
    }
};

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'license-manager-plugin', version: '1.0.0' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Database connection
const sequelize = new Sequelize(CONFIG.DB_NAME, CONFIG.DB_USER, CONFIG.DB_PASS, {
    host: CONFIG.DB_HOST,
    port: CONFIG.DB_PORT,
    dialect: 'postgres',
    logging: (msg) => logger.debug(msg),
    pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

// Database Models
const License = sequelize.define('License', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    licenseKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: 'license_key'
    },
    pluginId: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'plugin_id'
    },
    customerId: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'customer_id'
    },
    customerEmail: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'customer_email'
    },
    customerName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'customer_name'
    },
    licenseType: {
        type: DataTypes.ENUM('1-year', '3-year', '5-year', 'perpetual'),
        allowNull: false,
        field: 'license_type'
    },
    status: {
        type: DataTypes.ENUM('active', 'expired', 'revoked', 'suspended'),
        defaultValue: 'active'
    },
    issuedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'issued_at'
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at'
    },
    activatedAt: {
        type: DataTypes.DATE,
        field: 'activated_at'
    },
    activatedBy: {
        type: DataTypes.STRING,
        field: 'activated_by'
    },
    activationCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        field: 'activation_count'
    },
    maxActivations: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        field: 'max_activations'
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'licenses',
    timestamps: true,
    indexes: [
        { fields: ['license_key'] },
        { fields: ['plugin_id'] },
        { fields: ['customer_id'] },
        { fields: ['status'] },
        { fields: ['expires_at'] }
    ]
});

const LicenseActivation = sequelize.define('LicenseActivation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    licenseId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'license_id',
        references: {
            model: License,
            key: 'id'
        }
    },
    machineId: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'machine_id'
    },
    ipAddress: {
        type: DataTypes.STRING,
        field: 'ip_address'
    },
    userAgent: {
        type: DataTypes.TEXT,
        field: 'user_agent'
    },
    activatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'activated_at'
    },
    lastSeenAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'last_seen_at'
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'revoked'),
        defaultValue: 'active'
    }
}, {
    tableName: 'license_activations',
    timestamps: true,
    indexes: [
        { fields: ['license_id'] },
        { fields: ['machine_id'] },
        { fields: ['status'] }
    ]
});

// Define associations
License.hasMany(LicenseActivation, { foreignKey: 'licenseId', as: 'activations' });
LicenseActivation.belongsTo(License, { foreignKey: 'licenseId', as: 'license' });

// Express app setup
const app = express();

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await sequelize.authenticate();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'CoreBridge License Manager',
            version: '1.0.0',
            database: 'connected',
            uptime: process.uptime()
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// License management dashboard
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>CoreBridge License Manager</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container { 
                    background: white; 
                    border-radius: 20px; 
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                    padding: 40px;
                    max-width: 1200px;
                    width: 100%;
                }
                .header { 
                    text-align: center; 
                    margin-bottom: 40px; 
                    color: #333;
                }
                .header h1 { 
                    font-size: 2.5em; 
                    margin-bottom: 10px; 
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .section { 
                    margin-bottom: 30px; 
                    padding: 25px; 
                    border: 1px solid #e0e0e0; 
                    border-radius: 15px;
                    background: #f9f9f9;
                }
                .section h2 { 
                    color: #555; 
                    margin-bottom: 20px; 
                    font-size: 1.4em;
                }
                .form-group { 
                    margin-bottom: 20px; 
                }
                .form-group label { 
                    display: block; 
                    margin-bottom: 8px; 
                    font-weight: 600; 
                    color: #555;
                }
                .form-group input, .form-group select { 
                    width: 100%; 
                    padding: 12px; 
                    border: 2px solid #ddd; 
                    border-radius: 8px; 
                    font-size: 14px;
                    transition: border-color 0.3s;
                }
                .form-group input:focus, .form-group select:focus { 
                    outline: none; 
                    border-color: #667eea; 
                }
                .btn { 
                    background: linear-gradient(135deg, #667eea, #764ba2); 
                    color: white; 
                    padding: 12px 30px; 
                    border: none; 
                    border-radius: 8px; 
                    cursor: pointer; 
                    font-size: 16px;
                    font-weight: 600;
                    transition: transform 0.2s;
                }
                .btn:hover { 
                    transform: translateY(-2px); 
                }
                .btn:disabled { 
                    opacity: 0.6; 
                    cursor: not-allowed; 
                    transform: none;
                }
                .result { 
                    margin-top: 20px; 
                    padding: 15px; 
                    border-radius: 8px; 
                    display: none;
                }
                .result.success { 
                    background: #d4edda; 
                    border: 1px solid #c3e6cb; 
                    color: #155724; 
                }
                .result.error { 
                    background: #f8d7da; 
                    border: 1px solid #f5c6cb; 
                    color: #721c24; 
                }
                .grid { 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
                    gap: 20px; 
                }
                .license-card { 
                    background: white; 
                    padding: 20px; 
                    border-radius: 10px; 
                    border: 1px solid #e0e0e0;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                .status-badge { 
                    padding: 4px 12px; 
                    border-radius: 20px; 
                    font-size: 12px; 
                    font-weight: 600; 
                    text-transform: uppercase;
                }
                .status-badge.active { 
                    background: #d4edda; 
                    color: #155724; 
                }
                .status-badge.expired { 
                    background: #f8d7da; 
                    color: #721c24; 
                }
                .loading { 
                    display: inline-block; 
                    width: 20px; 
                    height: 20px; 
                    border: 3px solid #f3f3f3; 
                    border-top: 3px solid #667eea; 
                    border-radius: 50%; 
                    animation: spin 1s linear infinite; 
                }
                @keyframes spin { 
                    0% { transform: rotate(0deg); } 
                    100% { transform: rotate(360deg); } 
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔐 CoreBridge License Manager</h1>
                    <p>Professional Plugin Licensing System</p>
                </div>

                <div class="grid">
                    <!-- Generate License Section -->
                    <div class="section">
                        <h2>📝 Generate New License</h2>
                        <form id="generateForm">
                            <div class="form-group">
                                <label for="pluginId">Plugin ID:</label>
                                <input type="text" id="pluginId" required placeholder="e.g., corebridge-ping">
                            </div>
                            <div class="form-group">
                                <label for="customerName">Customer Name:</label>
                                <input type="text" id="customerName" required placeholder="John Doe">
                            </div>
                            <div class="form-group">
                                <label for="customerEmail">Customer Email:</label>
                                <input type="email" id="customerEmail" required placeholder="john@example.com">
                            </div>
                            <div class="form-group">
                                <label for="licenseType">License Type:</label>
                                <select id="licenseType" required>
                                    <option value="">Select license duration</option>
                                    <option value="1-year">1 Year</option>
                                    <option value="3-year">3 Years</option>
                                    <option value="5-year">5 Years</option>
                                    <option value="perpetual">Perpetual</option>
                                </select>
                            </div>
                            <button type="submit" class="btn">Generate License</button>
                        </form>
                        <div id="generateResult" class="result"></div>
                    </div>

                    <!-- Validate License Section -->
                    <div class="section">
                        <h2>🔍 Validate License</h2>
                        <form id="validateForm">
                            <div class="form-group">
                                <label for="validateKey">License Key:</label>
                                <input type="text" id="validateKey" required placeholder="Enter license key">
                            </div>
                            <div class="form-group">
                                <label for="validatePlugin">Plugin ID:</label>
                                <input type="text" id="validatePlugin" required placeholder="e.g., corebridge-ping">
                            </div>
                            <button type="submit" class="btn">Validate License</button>
                        </form>
                        <div id="validateResult" class="result"></div>
                    </div>
                </div>

                <!-- Licenses List Section -->
                <div class="section">
                    <h2>📋 License Management</h2>
                    <button onclick="loadLicenses()" class="btn">Refresh Licenses</button>
                    <div id="licensesList" style="margin-top: 20px;"></div>
                </div>
            </div>

            <script>
                // Generate License
                document.getElementById('generateForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = e.target.querySelector('.btn');
                    const result = document.getElementById('generateResult');
                    
                    btn.disabled = true;
                    btn.innerHTML = '<span class="loading"></span> Generating...';
                    
                    try {
                        const response = await fetch('/api/licenses/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pluginId: document.getElementById('pluginId').value,
                                customerName: document.getElementById('customerName').value,
                                customerEmail: document.getElementById('customerEmail').value,
                                licenseType: document.getElementById('licenseType').value
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (response.ok) {
                            result.className = 'result success';
                            result.innerHTML = \`
                                <h3>✅ License Generated Successfully!</h3>
                                <p><strong>License Key:</strong> \${data.licenseKey}</p>
                                <p><strong>Expires:</strong> \${new Date(data.expiresAt).toLocaleDateString()}</p>
                                <p><strong>Customer:</strong> \${data.customerName} (\${data.customerEmail})</p>
                            \`;
                            e.target.reset();
                        } else {
                            throw new Error(data.error || 'Failed to generate license');
                        }
                    } catch (error) {
                        result.className = 'result error';
                        result.innerHTML = \`<h3>❌ Error:</h3><p>\${error.message}</p>\`;
                    }
                    
                    result.style.display = 'block';
                    btn.disabled = false;
                    btn.innerHTML = 'Generate License';
                });

                // Validate License
                document.getElementById('validateForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const btn = e.target.querySelector('.btn');
                    const result = document.getElementById('validateResult');
                    
                    btn.disabled = true;
                    btn.innerHTML = '<span class="loading"></span> Validating...';
                    
                    try {
                        const response = await fetch('/api/licenses/validate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                licenseKey: document.getElementById('validateKey').value,
                                pluginId: document.getElementById('validatePlugin').value
                            })
                        });
                        
                        const data = await response.json();
                        
                        if (response.ok && data.valid) {
                            result.className = 'result success';
                            result.innerHTML = \`
                                <h3>✅ License Valid!</h3>
                                <p><strong>Status:</strong> \${data.status}</p>
                                <p><strong>Expires:</strong> \${new Date(data.expiresAt).toLocaleDateString()}</p>
                                <p><strong>Days Remaining:</strong> \${data.daysRemaining}</p>
                            \`;
                        } else {
                            result.className = 'result error';
                            result.innerHTML = \`<h3>❌ License Invalid</h3><p>\${data.message || 'License validation failed'}</p>\`;
                        }
                    } catch (error) {
                        result.className = 'result error';
                        result.innerHTML = \`<h3>❌ Error:</h3><p>\${error.message}</p>\`;
                    }
                    
                    result.style.display = 'block';
                    btn.disabled = false;
                    btn.innerHTML = 'Validate License';
                });

                // Load Licenses
                async function loadLicenses() {
                    const container = document.getElementById('licensesList');
                    container.innerHTML = '<div class="loading"></div> Loading licenses...';
                    
                    try {
                        const response = await fetch('/api/licenses');
                        const data = await response.json();
                        
                        if (response.ok) {
                            if (data.licenses.length === 0) {
                                container.innerHTML = '<p>No licenses found.</p>';
                                return;
                            }
                            
                            container.innerHTML = data.licenses.map(license => \`
                                <div class="license-card">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                        <strong>\${license.pluginId}</strong>
                                        <span class="status-badge \${license.status}">\${license.status}</span>
                                    </div>
                                    <p><strong>Customer:</strong> \${license.customerName} (\${license.customerEmail})</p>
                                    <p><strong>License Key:</strong> \${license.licenseKey.substring(0, 20)}...</p>
                                    <p><strong>Type:</strong> \${license.licenseType}</p>
                                    <p><strong>Expires:</strong> \${new Date(license.expiresAt).toLocaleDateString()}</p>
                                    <p><strong>Activations:</strong> \${license.activationCount}/\${license.maxActivations}</p>
                                </div>
                            \`).join('');
                        } else {
                            throw new Error(data.error || 'Failed to load licenses');
                        }
                    } catch (error) {
                        container.innerHTML = \`<div class="result error">Error loading licenses: \${error.message}</div>\`;
                    }
                }

                // Load licenses on page load
                loadLicenses();
            </script>
        </body>
        </html>
    `);
});

// API Routes

// Generate a new license
app.post('/api/licenses/generate', async (req, res) => {
    try {
        const { pluginId, customerName, customerEmail, licenseType, maxActivations = 1 } = req.body;

        if (!pluginId || !customerName || !customerEmail || !licenseType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Generate unique license key
        const licenseKey = generateLicenseKey(pluginId, customerEmail);

        // Calculate expiration date
        let expiresAt;
        if (licenseType === 'perpetual') {
            expiresAt = new Date('2099-12-31');
        } else {
            const days = CONFIG.LICENSE_VALIDITY_DAYS[licenseType];
            if (!days) {
                return res.status(400).json({ error: 'Invalid license type' });
            }
            expiresAt = moment().add(days, 'days').toDate();
        }

        // Create license in database
        const license = await License.create({
            licenseKey,
            pluginId,
            customerId: generateCustomerId(customerEmail),
            customerEmail,
            customerName,
            licenseType,
            expiresAt,
            maxActivations
        });

        logger.info('License generated', {
            licenseId: license.id,
            pluginId,
            customerEmail,
            licenseType
        });

        res.json({
            success: true,
            licenseKey: license.licenseKey,
            licenseId: license.id,
            pluginId: license.pluginId,
            customerName: license.customerName,
            customerEmail: license.customerEmail,
            licenseType: license.licenseType,
            expiresAt: license.expiresAt,
            maxActivations: license.maxActivations
        });

    } catch (error) {
        logger.error('Error generating license:', error);
        res.status(500).json({ error: 'Failed to generate license' });
    }
});

// Validate a license
app.post('/api/licenses/validate', async (req, res) => {
    try {
        const { licenseKey, pluginId, machineId } = req.body;

        if (!licenseKey || !pluginId) {
            return res.status(400).json({ 
                valid: false, 
                message: 'License key and plugin ID are required' 
            });
        }

        const license = await License.findOne({
            where: { licenseKey, pluginId },
            include: [{ model: LicenseActivation, as: 'activations' }]
        });

        if (!license) {
            return res.json({ 
                valid: false, 
                message: 'License not found' 
            });
        }

        // Check if license is expired
        if (license.expiresAt < new Date()) {
            await license.update({ status: 'expired' });
            return res.json({ 
                valid: false, 
                message: 'License has expired' 
            });
        }

        // Check if license is revoked or suspended
        if (license.status !== 'active') {
            return res.json({ 
                valid: false, 
                message: `License is ${license.status}` 
            });
        }

        // Calculate days remaining
        const daysRemaining = moment(license.expiresAt).diff(moment(), 'days');

        // If machineId is provided, handle activation
        if (machineId) {
            const existingActivation = await LicenseActivation.findOne({
                where: { licenseId: license.id, machineId, status: 'active' }
            });

            if (!existingActivation) {
                // Check if we can add a new activation
                const activeActivations = license.activations.filter(a => a.status === 'active').length;
                if (activeActivations >= license.maxActivations) {
                    return res.json({ 
                        valid: false, 
                        message: 'Maximum number of activations reached' 
                    });
                }

                // Create new activation
                await LicenseActivation.create({
                    licenseId: license.id,
                    machineId,
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent')
                });

                // Update license activation count
                await license.update({ 
                    activationCount: license.activationCount + 1,
                    activatedAt: new Date(),
                    activatedBy: machineId
                });

                logger.info('License activated', {
                    licenseId: license.id,
                    machineId,
                    pluginId
                });
            } else {
                // Update last seen
                await existingActivation.update({ lastSeenAt: new Date() });
            }
        }

        res.json({
            valid: true,
            licenseId: license.id,
            status: license.status,
            licenseType: license.licenseType,
            expiresAt: license.expiresAt,
            daysRemaining,
            activationCount: license.activationCount,
            maxActivations: license.maxActivations,
            warningThresholds: {
                show90DayWarning: daysRemaining <= 90,
                show60DayWarning: daysRemaining <= 60,
                show45DayWarning: daysRemaining <= 45,
                show30DayWarning: daysRemaining <= 30,
                show15DayWarning: daysRemaining <= 15,
                showDailyWarning: daysRemaining <= 7
            }
        });

    } catch (error) {
        logger.error('Error validating license:', error);
        res.status(500).json({ 
            valid: false, 
            message: 'Internal server error' 
        });
    }
});

// Get all licenses
app.get('/api/licenses', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, pluginId } = req.query;
        
        const where = {};
        if (status) where.status = status;
        if (pluginId) where.pluginId = pluginId;

        const licenses = await License.findAndCountAll({
            where,
            include: [{ model: LicenseActivation, as: 'activations' }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (page - 1) * limit
        });

        res.json({
            licenses: licenses.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: licenses.count,
                pages: Math.ceil(licenses.count / limit)
            }
        });

    } catch (error) {
        logger.error('Error fetching licenses:', error);
        res.status(500).json({ error: 'Failed to fetch licenses' });
    }
});

// Revoke a license
app.post('/api/licenses/:licenseId/revoke', async (req, res) => {
    try {
        const { licenseId } = req.params;
        const { reason } = req.body;

        const license = await License.findByPk(licenseId);
        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }

        await license.update({ 
            status: 'revoked',
            metadata: { ...license.metadata, revocationReason: reason, revokedAt: new Date() }
        });

        // Revoke all activations
        await LicenseActivation.update(
            { status: 'revoked' },
            { where: { licenseId, status: 'active' } }
        );

        logger.info('License revoked', { licenseId, reason });

        res.json({ success: true, message: 'License revoked successfully' });

    } catch (error) {
        logger.error('Error revoking license:', error);
        res.status(500).json({ error: 'Failed to revoke license' });
    }
});

// License expiration notification endpoints for core system
app.get('/api/licenses/expiring', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const expirationDate = moment().add(days, 'days').toDate();

        const expiringLicenses = await License.findAll({
            where: {
                status: 'active',
                expiresAt: {
                    [Sequelize.Op.lte]: expirationDate,
                    [Sequelize.Op.gt]: new Date()
                }
            },
            include: [{ model: LicenseActivation, as: 'activations' }]
        });

        res.json({ licenses: expiringLicenses });

    } catch (error) {
        logger.error('Error fetching expiring licenses:', error);
        res.status(500).json({ error: 'Failed to fetch expiring licenses' });
    }
});

// Helper functions
function generateLicenseKey(pluginId, customerEmail) {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 15);
    const hash = crypto.createHash('sha256')
        .update(`${pluginId}-${customerEmail}-${timestamp}-${random}`)
        .digest('hex');
    
    // Format as groups of 4 characters separated by hyphens
    const key = hash.substring(0, 20).toUpperCase();
    return `CB-${key.match(/.{1,4}/g).join('-')}`;
}

function generateCustomerId(email) {
    return crypto.createHash('sha256').update(email).digest('hex').substring(0, 16).toUpperCase();
}

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Database initialization and server startup
async function startServer() {
    try {
        // Test database connection
        await sequelize.authenticate();
        logger.info('Database connection established successfully');

        // Sync database models
        await sequelize.sync({ alter: true });
        logger.info('Database models synchronized');

        // Start the server
        const server = app.listen(CONFIG.PORT, () => {
            logger.info(`CoreBridge License Manager started on port ${CONFIG.PORT}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, shutting down gracefully');
            server.close(() => {
                sequelize.close();
                process.exit(0);
            });
        });

        // Setup license expiration monitoring (runs daily at 9 AM)
        cron.schedule('0 9 * * *', async () => {
            try {
                await checkExpiringLicenses();
            } catch (error) {
                logger.error('Error in license expiration check:', error);
            }
        });

        logger.info('License Manager initialized successfully');

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// License expiration monitoring
async function checkExpiringLicenses() {
    const thresholds = [90, 60, 45, 30, 15, 7, 3, 1];
    
    for (const days of thresholds) {
        const startDate = moment().add(days, 'days').startOf('day');
        const endDate = moment().add(days, 'days').endOf('day');

        const expiringLicenses = await License.findAll({
            where: {
                status: 'active',
                expiresAt: {
                    [Sequelize.Op.between]: [startDate.toDate(), endDate.toDate()]
                }
            }
        });

        for (const license of expiringLicenses) {
            logger.info(`License expiring in ${days} days`, {
                licenseId: license.id,
                pluginId: license.pluginId,
                customerEmail: license.customerEmail,
                expiresAt: license.expiresAt
            });

            // Here you could send notifications to CoreBridge core
            // or directly to customers via email
        }
    }
}

// Start the server
startServer(); 