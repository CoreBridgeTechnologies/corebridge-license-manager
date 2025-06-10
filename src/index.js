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

// Plugin model for tracking available plugins
const Plugin = sequelize.define('Plugin', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT
    },
    version: {
        type: DataTypes.STRING
    },
    author: {
        type: DataTypes.STRING
    },
    category: {
        type: DataTypes.STRING
    },
    tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: []
    },
    status: {
        type: DataTypes.ENUM('discovered', 'enabled', 'disabled'),
        defaultValue: 'discovered'
    },
    healthStatus: {
        type: DataTypes.ENUM('healthy', 'unhealthy', 'unreachable'),
        field: 'health_status'
    },
    lastSeen: {
        type: DataTypes.DATE,
        field: 'last_seen'
    }
}, {
    tableName: 'plugins',
    timestamps: true
});

// Define associations
License.hasMany(LicenseActivation, { foreignKey: 'licenseId', as: 'activations' });
LicenseActivation.belongsTo(License, { foreignKey: 'licenseId', as: 'license' });

// Add plugin associations
// License.belongsTo(Plugin, { foreignKey: 'pluginId', as: 'plugin' });
// Plugin.hasMany(License, { foreignKey: 'pluginId', as: 'licenses' });

// Express app setup
const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: null,
        },
    },
}));
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
                .status-badge.revoked { 
                    background: #343a40; 
                    color: white; 
                }
                .status-badge.suspended { 
                    background: #ffeaa7; 
                    color: #2d3436; 
                }
                .btn-small { 
                    padding: 6px 12px; 
                    font-size: 12px; 
                    border-radius: 4px; 
                    border: none; 
                    cursor: pointer; 
                    font-weight: 600;
                    transition: all 0.2s;
                }
                .btn-danger { 
                    background: #dc3545; 
                    color: white; 
                }
                .btn-danger:hover { 
                    background: #c82333; 
                    transform: translateY(-1px);
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
                .plugin-search-container {
                    position: relative;
                    width: 100%;
                }
                .plugin-search-input {
                    width: 100%;
                    padding: 12px 40px 12px 12px;
                    border: 2px solid #ddd;
                    border-radius: 8px;
                    font-size: 14px;
                    transition: border-color 0.3s;
                    background: white;
                }
                .plugin-search-input:focus {
                    outline: none;
                    border-color: #667eea;
                }
                .plugin-search-icon {
                    position: absolute;
                    right: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #999;
                    pointer-events: none;
                }
                .plugin-suggestions {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background: white;
                    border: 2px solid #ddd;
                    border-top: none;
                    border-radius: 0 0 8px 8px;
                    max-height: 200px;
                    overflow-y: auto;
                    z-index: 1000;
                    display: none;
                }
                .plugin-suggestion {
                    padding: 12px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    border-bottom: 1px solid #f0f0f0;
                }
                .plugin-suggestion:hover {
                    background: #f8f9fa;
                }
                .plugin-suggestion:last-child {
                    border-bottom: none;
                }
                .plugin-suggestion.selected {
                    background: #667eea;
                    color: white;
                }
                .plugin-id {
                    font-weight: 600;
                    font-family: monospace;
                    color: #667eea;
                }
                .plugin-suggestion.selected .plugin-id {
                    color: white;
                }
                .plugin-name {
                    font-size: 14px;
                    margin-top: 2px;
                }
                .plugin-category {
                    font-size: 11px;
                    opacity: 0.7;
                    margin-top: 2px;
                    text-transform: uppercase;
                }
                .plugin-status {
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 10px;
                    margin-top: 4px;
                    display: inline-block;
                }
                .plugin-status.enabled {
                    background: #d4edda;
                    color: #155724;
                }
                .plugin-status.disabled {
                    background: #f8d7da;
                    color: #721c24;
                }
                .plugin-status.discovered {
                    background: #fff3cd;
                    color: #856404;
                }
                .sync-button {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    margin-left: 10px;
                    font-size: 14px;
                    padding: 8px 16px;
                }
                
                /* Plugin Search Dropdown Styles */
                .plugin-search-container {
                    position: relative;
                    width: 100%;
                }
                
                .search-dropdown {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background: white;
                    border: 1px solid #ddd;
                    border-top: none;
                    border-radius: 0 0 8px 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    max-height: 300px;
                    overflow-y: auto;
                    z-index: 1000;
                    display: none;
                }
                
                .search-dropdown.active {
                    display: block;
                }
                
                .dropdown-item {
                    padding: 12px 15px;
                    border-bottom: 1px solid #f0f0f0;
                    cursor: pointer;
                    transition: background-color 0.2s;
                }
                
                .dropdown-item:hover,
                .dropdown-item.highlighted {
                    background-color: #f8f9ff;
                }
                
                .dropdown-item:last-child {
                    border-bottom: none;
                }
                
                .plugin-name {
                    font-weight: bold;
                    color: #333;
                    margin-bottom: 4px;
                }
                
                .plugin-details {
                    font-size: 12px;
                    color: #666;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .plugin-category {
                    background: #e3f2fd;
                    color: #1976d2;
                    padding: 2px 6px;
                    border-radius: 12px;
                    font-size: 10px;
                    text-transform: uppercase;
                }
                
                .plugin-status {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .status-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #4caf50;
                }
                
                .status-dot.unhealthy {
                    background: #f44336;
                }
                
                .no-results {
                    padding: 15px;
                    text-align: center;
                    color: #999;
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔐 CoreBridge License Manager</h1>
                    <p>Enterprise-grade software licensing and activation system</p>
                    <button onclick="syncPlugins()" class="btn sync-button" style="margin-top: 20px;">🔄 Refresh Plugins</button>
                    <div id="syncStatus" style="margin-top: 10px; font-size: 14px;"></div>
                </div>

                <div class="grid">
                    <!-- Generate License Section -->
                    <div class="section">
                        <h2>📝 Generate New License</h2>
                        <form id="generateForm">
                            <div class="form-group">
                                <label for="pluginId">Plugin ID:</label>
                                <div class="plugin-search-container">
                                    <input type="text" id="pluginId" required placeholder="Type to search plugins..." autocomplete="off">
                                    <div class="search-dropdown" id="pluginIdDropdown"></div>
                                </div>
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
                                <div class="plugin-search-container">
                                    <input type="text" id="validatePlugin" required placeholder="Type to search plugins..." autocomplete="off">
                                    <div class="search-dropdown" id="validatePluginDropdown"></div>
                                </div>
                            </div>
                            <button type="submit" class="btn">Validate License</button>
                        </form>
                        <div id="validateResult" class="result"></div>
                    </div>
                </div>

                <!-- Licenses List Section -->
                <div class="section">
                    <h2>📋 License Management</h2>
                    <div style="margin-bottom: 20px;">
                        <button onclick="loadLicenses()" class="btn">Refresh Licenses</button>
                        <button onclick="syncPlugins()" class="btn sync-button">🔄 Refresh Plugins</button>
                    </div>
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
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <span class="status-badge \${license.status}">\${license.status}</span>
                                            \${license.status === 'active' ? 
                                                '<button onclick="revokeLicense(\\'' + license.id + '\\')" class="btn-small btn-danger">🚫 Revoke</button>' : 
                                                license.status === 'revoked' && license.metadata?.revocationReason ? 
                                                '<span title="Revoked: ' + (license.metadata.revocationReason || '') + '" style="color: #666; font-size: 12px;">ℹ️</span>' : ''
                                            }
                                        </div>
                                    </div>
                                    <p><strong>Customer:</strong> \${license.customerName} (\${license.customerEmail})</p>
                                    <p><strong>License Key:</strong> \${license.licenseKey.substring(0, 20)}...</p>
                                    <p><strong>Type:</strong> \${license.licenseType}</p>
                                    <p><strong>Expires:</strong> \${new Date(license.expiresAt).toLocaleDateString()}</p>
                                    <p><strong>Activations:</strong> \${license.activationCount}/\${license.maxActivations}</p>
                                    \${license.status === 'revoked' && license.metadata?.revokedAt ? 
                                        '<p><strong>Revoked:</strong> ' + new Date(license.metadata.revokedAt).toLocaleDateString() + '</p>' : ''
                                    }
                                    \${license.metadata?.revocationReason ? 
                                        '<p><strong>Reason:</strong> ' + (license.metadata.revocationReason || '') + '</p>' : ''
                                    }
                                </div>
                            \`).join('');
                        } else {
                            throw new Error(data.error || 'Failed to load licenses');
                        }
                    } catch (error) {
                        container.innerHTML = '<div class="result error">Error loading licenses: ' + error.message + '</div>';
                    }
                }

                // Revoke License
                async function revokeLicense(licenseId) {
                    const reason = prompt('Please enter a reason for revoking this license:');
                    if (!reason) {
                        return; // User cancelled
                    }

                    if (!confirm('Are you sure you want to revoke this license? This action cannot be undone.')) {
                        return;
                    }

                    try {
                        const response = await fetch('/api/licenses/' + licenseId + '/revoke', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reason })
                        });

                        const data = await response.json();

                        if (response.ok) {
                            alert('✅ License revoked successfully!');
                            loadLicenses(); // Refresh the license list
                        } else {
                            throw new Error(data.error || 'Failed to revoke license');
                        }
                    } catch (error) {
                        alert('❌ Error revoking license: ' + error.message);
                    }
                }

                // Load licenses on page load
                loadLicenses();
                
                // Global plugins data
                let availablePlugins = [];
                
                // Initialize plugin search dropdowns
                function initializePluginSearch() {
                    const pluginIdInput = document.getElementById('pluginId');
                    const pluginIdDropdown = document.getElementById('pluginIdDropdown');
                    const validatePluginInput = document.getElementById('validatePlugin');
                    const validatePluginDropdown = document.getElementById('validatePluginDropdown');
                    
                    // Setup search for generate form
                    setupPluginSearch(pluginIdInput, pluginIdDropdown);
                    // Setup search for validate form
                    setupPluginSearch(validatePluginInput, validatePluginDropdown);
                }
                
                // Setup plugin search functionality for a specific input/dropdown pair
                function setupPluginSearch(input, dropdown) {
                    let highlightedIndex = -1;
                    let filteredPlugins = [];
                    
                    // Focus event - show all plugins
                    input.addEventListener('focus', () => {
                        const query = input.value.toLowerCase();
                        filteredPlugins = filterPlugins(query);
                        renderDropdown(dropdown, filteredPlugins);
                        showDropdown(dropdown);
                    });
                    
                    // Input event - filter as user types
                    input.addEventListener('input', (e) => {
                        const query = e.target.value.toLowerCase();
                        filteredPlugins = filterPlugins(query);
                        highlightedIndex = -1;
                        renderDropdown(dropdown, filteredPlugins);
                        showDropdown(dropdown);
                    });
                    
                    // Keyboard navigation
                    input.addEventListener('keydown', (e) => {
                        if (dropdown.style.display === 'none') return;
                        
                        switch(e.key) {
                            case 'ArrowDown':
                                e.preventDefault();
                                highlightedIndex = Math.min(highlightedIndex + 1, filteredPlugins.length - 1);
                                updateHighlight(dropdown, highlightedIndex);
                                break;
                            case 'ArrowUp':
                                e.preventDefault();
                                highlightedIndex = Math.max(highlightedIndex - 1, -1);
                                updateHighlight(dropdown, highlightedIndex);
                                break;
                            case 'Enter':
                                e.preventDefault();
                                if (highlightedIndex >= 0 && filteredPlugins[highlightedIndex]) {
                                    selectPlugin(input, dropdown, filteredPlugins[highlightedIndex]);
                                }
                                break;
                            case 'Escape':
                                hideDropdown(dropdown);
                                input.blur();
                                break;
                        }
                    });
                    
                    // Click outside to close
                    document.addEventListener('click', (e) => {
                        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                            hideDropdown(dropdown);
                        }
                    });
                }
                
                // Filter plugins based on query
                function filterPlugins(query) {
                    if (!query) return availablePlugins;
                    
                    return availablePlugins.filter(plugin => {
                        const searchText = (plugin.id + ' ' + plugin.name + ' ' + plugin.category + ' ' + (plugin.description || '')).toLowerCase();
                        return searchText.includes(query);
                    }).sort((a, b) => {
                        // Prioritize exact ID matches, then name matches
                        const aIdMatch = a.id.toLowerCase().startsWith(query);
                        const bIdMatch = b.id.toLowerCase().startsWith(query);
                        const aNameMatch = a.name.toLowerCase().startsWith(query);
                        const bNameMatch = b.name.toLowerCase().startsWith(query);
                        
                        if (aIdMatch && !bIdMatch) return -1;
                        if (bIdMatch && !aIdMatch) return 1;
                        if (aNameMatch && !bNameMatch) return -1;
                        if (bNameMatch && !aNameMatch) return 1;
                        
                        return a.name.localeCompare(b.name);
                    });
                }
                
                // Render dropdown with filtered plugins
                function renderDropdown(dropdown, plugins) {
                    if (plugins.length === 0) {
                        dropdown.innerHTML = '<div class="no-results">No plugins found</div>';
                        return;
                    }
                    
                    dropdown.innerHTML = plugins.map((plugin, index) => {
                        const statusClass = plugin.healthStatus === 'healthy' ? '' : 'unhealthy';
                        return '<div class="dropdown-item" data-plugin-id="' + plugin.id + '" data-index="' + index + '">' +
                            '<div class="plugin-name">' + plugin.name + '</div>' +
                            '<div class="plugin-details">' +
                                '<div>' +
                                    '<strong>' + plugin.id + '</strong>' +
                                    '<span class="plugin-category">' + plugin.category + '</span>' +
                                '</div>' +
                                '<div class="plugin-status">' +
                                    '<span class="status-dot ' + statusClass + '"></span>' +
                                    '<span>' + plugin.healthStatus + '</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                    
                    // Add click handlers
                    dropdown.querySelectorAll('.dropdown-item').forEach((item, index) => {
                        item.addEventListener('click', () => {
                            selectPlugin(dropdown.previousElementSibling, dropdown, plugins[index]);
                        });
                    });
                }
                
                // Update highlight
                function updateHighlight(dropdown, index) {
                    dropdown.querySelectorAll('.dropdown-item').forEach((item, i) => {
                        if (i === index) {
                            item.classList.add('highlighted');
                            item.scrollIntoView({ block: 'nearest' });
                        } else {
                            item.classList.remove('highlighted');
                        }
                    });
                }
                
                // Select a plugin
                function selectPlugin(input, dropdown, plugin) {
                    input.value = plugin.id;
                    hideDropdown(dropdown);
                    
                    // Trigger change event for validation
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Show dropdown
                function showDropdown(dropdown) {
                    dropdown.classList.add('active');
                    dropdown.style.display = 'block';
                }
                
                // Hide dropdown
                function hideDropdown(dropdown) {
                    dropdown.classList.remove('active');
                    dropdown.style.display = 'none';
                }
                
                // Load plugins for search
                async function loadPluginSuggestions() {
                    try {
                        const response = await fetch('/api/plugins/suggestions?limit=50');
                        const data = await response.json();
                        const statusDiv = document.getElementById('syncStatus');
                        
                        if (data.suggestions) {
                            availablePlugins = data.suggestions;
                            
                            if (statusDiv) {
                                statusDiv.innerHTML = '✅ ' + data.suggestions.length + ' plugins loaded. Plugin search is now active.';
                                statusDiv.style.color = 'green';
                            }
                        } else {
                            availablePlugins = [];
                            if (statusDiv) {
                                statusDiv.innerHTML = '⚠️ No plugins found. Auto-sync may have failed - try refreshing the page.';
                                statusDiv.style.color = 'red';
                            }
                        }
                    } catch (error) {
                        console.error('Failed to load plugin suggestions:', error);
                        availablePlugins = [];
                        const statusDiv = document.getElementById('syncStatus');
                        if (statusDiv) {
                            statusDiv.innerHTML = '❌ Failed to load plugins. Auto-sync may have failed - try refreshing the page.';
                            statusDiv.style.color = 'red';
                        }
                    }
                }
                
                // Auto-sync plugins and initialize search on page load
                autoSyncAndInitialize();
                
                // Auto-sync function for page load
                async function autoSyncAndInitialize() {
                    const statusDiv = document.getElementById('syncStatus');
                    
                    if (statusDiv) {
                        statusDiv.innerHTML = '🔄 Auto-syncing plugins from CoreBridge core system...';
                        statusDiv.style.color = 'blue';
                    }
                    
                    try {
                        // First try to sync plugins
                        const syncResponse = await fetch('/api/plugins/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                        const syncData = await syncResponse.json();
                        
                        if (syncResponse.ok) {
                            if (statusDiv) {
                                statusDiv.innerHTML = '✅ Auto-sync complete! ' + syncData.stats.synced + ' new, ' + syncData.stats.updated + ' updated, ' + syncData.stats.total + ' total plugins.';
                                statusDiv.style.color = 'green';
                            }
                        } else {
                            throw new Error(syncData.error || 'Failed to sync plugins');
                        }
                        
                        // Then load plugin suggestions and initialize search
                        await loadPluginSuggestions();
                        initializePluginSearch();
                        
                    } catch (error) {
                        console.warn('Auto-sync failed, falling back to cached plugins:', error);
                        if (statusDiv) {
                            statusDiv.innerHTML = '⚠️ Auto-sync failed, using cached plugins. You can manually sync if needed.';
                            statusDiv.style.color = 'orange';
                        }
                        
                        // Still try to load cached plugins
                        try {
                            await loadPluginSuggestions();
                            initializePluginSearch();
                        } catch (loadError) {
                            if (statusDiv) {
                                statusDiv.innerHTML = '❌ No plugins available. Please click "Sync Plugins" to load from core system.';
                                statusDiv.style.color = 'red';
                            }
                        }
                    }
                }
                
                // Manual sync plugins function (for the sync button)
                async function syncPlugins() {
                    const btn = event.target;
                    const originalText = btn.innerHTML;
                    const statusDiv = document.getElementById('syncStatus');
                    
                    btn.disabled = true;
                    btn.innerHTML = '<span class="loading"></span> Syncing...';
                    
                    if (statusDiv) {
                        statusDiv.innerHTML = '🔄 Syncing plugins from CoreBridge core system...';
                        statusDiv.style.color = 'blue';
                    }
                    
                    try {
                        const response = await fetch('/api/plugins/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                        const data = await response.json();
                        
                        if (response.ok) {
                            if (statusDiv) {
                                statusDiv.innerHTML = '✅ Sync complete! ' + data.stats.synced + ' new, ' + data.stats.updated + ' updated, ' + data.stats.total + ' total plugins.';
                                statusDiv.style.color = 'green';
                            }
                            loadPluginSuggestions(); // Refresh the plugin search
                        } else {
                            throw new Error(data.error || 'Failed to sync plugins');
                        }
                    } catch (error) {
                        if (statusDiv) {
                            statusDiv.innerHTML = '❌ Sync failed: ' + error.message;
                            statusDiv.style.color = 'red';
                        }
                    }
                    
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
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
                message: 'License is ' + license.status
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

// Plugin management endpoints

// Get all plugins with context-aware search
app.get('/api/plugins', async (req, res) => {
    try {
        const { search, category, status, limit = 100 } = req.query;
        
        const where = {};
        const searchConditions = [];
        
        if (search) {
            // Context-aware search across multiple fields
            const searchTerm = `%${search.toLowerCase()}%`;
            searchConditions.push(
                { id: { [Sequelize.Op.iLike]: searchTerm } },
                { name: { [Sequelize.Op.iLike]: searchTerm } },
                { description: { [Sequelize.Op.iLike]: searchTerm } },
                { category: { [Sequelize.Op.iLike]: searchTerm } },
                { author: { [Sequelize.Op.iLike]: searchTerm } }
            );
            
            // Search in tags array
            searchConditions.push({
                tags: { [Sequelize.Op.overlap]: [search.toLowerCase()] }
            });
            
            where[Sequelize.Op.or] = searchConditions;
        }
        
        if (category) where.category = category;
        if (status) where.status = status;

        const plugins = await Plugin.findAll({
            where,
            include: [{
                model: License,
                as: 'licenses',
                attributes: ['id', 'status', 'licenseType', 'expiresAt'],
                required: false
            }],
            order: [
                ['name', 'ASC'],
                ['id', 'ASC']
            ],
            limit: parseInt(limit)
        });

        // Add license count to each plugin
        const pluginsWithStats = plugins.map(plugin => ({
            ...plugin.toJSON(),
            licenseCount: plugin.licenses ? plugin.licenses.length : 0,
            activeLicenses: plugin.licenses ? plugin.licenses.filter(l => l.status === 'active').length : 0
        }));

        res.json({ 
            plugins: pluginsWithStats,
            count: plugins.length
        });

    } catch (error) {
        logger.error('Error fetching plugins:', error);
        res.status(500).json({ error: 'Failed to fetch plugins' });
    }
});

// Sync plugins from CoreBridge core system
app.post('/api/plugins/sync', async (req, res) => {
    try {
        logger.info('Starting plugin sync from core system...');
        
        const coreResponse = await axios.get(`${CONFIG.CORE_API_URL}/api/plugins`, {
            timeout: 10000
        });
        
        if (!coreResponse.data || !coreResponse.data.data) {
            return res.status(400).json({ error: 'Invalid response from core system' });
        }
        
        const corePlugins = coreResponse.data.data;
        let syncedCount = 0;
        let updatedCount = 0;
        
        for (const corePlugin of corePlugins) {
            const existingPlugin = await Plugin.findByPk(corePlugin.id);
            
            const pluginData = {
                id: corePlugin.id,
                name: corePlugin.name || corePlugin.id,
                description: corePlugin.description || '',
                version: corePlugin.version || '1.0.0',
                author: corePlugin.author || 'Unknown',
                category: corePlugin.category || 'other',
                tags: corePlugin.tags || [],
                status: corePlugin.enabled ? 'enabled' : (corePlugin.running ? 'discovered' : 'disabled'),
                healthStatus: corePlugin.healthStatus || 'unreachable',
                lastSeen: new Date()
            };
            
            if (existingPlugin) {
                await existingPlugin.update(pluginData);
                updatedCount++;
            } else {
                await Plugin.create(pluginData);
                syncedCount++;
            }
        }
        
        logger.info(`Plugin sync completed: ${syncedCount} new, ${updatedCount} updated`);
        
        res.json({
            success: true,
            message: 'Plugins synced successfully',
            stats: {
                synced: syncedCount,
                updated: updatedCount,
                total: corePlugins.length
            }
        });

    } catch (error) {
        logger.error('Error syncing plugins:', error);
        res.status(500).json({ 
            error: 'Failed to sync plugins',
            details: error.message 
        });
    }
});

// Get plugin suggestions for autocomplete
app.get('/api/plugins/suggestions', async (req, res) => {
    try {
        const { q = '', limit = 10 } = req.query;
        
        if (!q.trim()) {
            const plugins = await Plugin.findAll({
                attributes: ['id', 'name', 'category', 'status', 'healthStatus'],
                order: [['name', 'ASC']],
                limit: parseInt(limit)
            });
            return res.json({ suggestions: plugins });
        }
        
        const searchTerm = `%${q.toLowerCase()}%`;
        const plugins = await Plugin.findAll({
            where: {
                [Sequelize.Op.or]: [
                    { id: { [Sequelize.Op.iLike]: searchTerm } },
                    { name: { [Sequelize.Op.iLike]: searchTerm } },
                    { category: { [Sequelize.Op.iLike]: searchTerm } }
                ]
            },
            attributes: ['id', 'name', 'category', 'status', 'healthStatus', 'description'],
            order: [['name', 'ASC']],
            limit: parseInt(limit)
        });

        res.json({ suggestions: plugins });
    } catch (error) {
        logger.error('Error fetching plugin suggestions:', error);
        res.status(500).json({ error: 'Failed to fetch suggestions' });
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