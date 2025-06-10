# CoreBridge License Manager Plugin

Enterprise-grade license management system for CoreBridge plugins with comprehensive validation, revocation, and audit capabilities.

## 🎯 Overview

The License Manager Plugin provides a complete licensing solution for commercial CoreBridge plugins, featuring:

- **🔑 License Generation**: Secure license key generation with machine binding
- **✅ Real-time Validation**: Live license validation with instant revocation support
- **📊 Comprehensive Tracking**: Usage monitoring and detailed audit trails
- **🌐 Web Interface**: User-friendly license management dashboard
- **🔒 Security Features**: Encrypted communication and tamper-resistant validation
- **🏢 Multi-tenant Support**: Organization-based license management

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- PostgreSQL database access
- CoreBridge Core system running

### Installation & Deployment

1. **Start the License Manager**:
```bash
cd plugins/corebridge-license-manager
docker-compose up -d
```

2. **Verify Installation**:
```bash
curl http://localhost:3008/health
```

3. **Access Web Interface**:
```bash
open http://localhost:3008
```

### First License Creation

1. **Create License via API**:
```bash
curl -X POST http://localhost:3008/api/licenses \
  -H "Content-Type: application/json" \
  -d '{
    "pluginId": "my-plugin",
    "licenseType": "commercial",
    "validFrom": "2024-01-01T00:00:00Z",
    "validUntil": "2025-01-01T00:00:00Z",
    "features": ["basic", "advanced"]
  }'
```

2. **Validate License**:
```bash
curl -X POST http://localhost:3008/api/licenses/validate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "CB-6049-4392-892E-F67B-CDE8",
    "pluginId": "my-plugin",
    "machineId": "my-machine-linux"
  }'
```

## 🏗️ Architecture

### Database Schema

The License Manager uses PostgreSQL with the following core tables:

#### Licenses Table
```sql
CREATE TABLE licenses (
  license_id VARCHAR(50) PRIMARY KEY,
  plugin_id VARCHAR(100) NOT NULL,
  organization_id VARCHAR(100),
  license_type VARCHAR(50) NOT NULL DEFAULT 'commercial',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  machine_id VARCHAR(200),
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
  valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
  features JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### License Audits Table
```sql
CREATE TABLE license_audits (
  audit_id SERIAL PRIMARY KEY,
  license_id VARCHAR(50) REFERENCES licenses(license_id),
  action VARCHAR(100) NOT NULL,
  actor VARCHAR(200),
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Service Components

#### Core Services
- **License Generator**: Cryptographically secure license key generation
- **Validation Engine**: Real-time license validation with comprehensive checks
- **Audit Logger**: Comprehensive audit trail for all license operations
- **Web Dashboard**: React-based management interface
- **API Server**: RESTful API for license operations

#### External Integrations
- **PostgreSQL**: Primary data persistence
- **CoreBridge Core**: Integration with main platform
- **Plugin Network**: Direct communication with licensed plugins

## 📚 API Reference

### License Management

#### Create License
```http
POST /api/licenses
Content-Type: application/json

{
  "pluginId": "advanced-analytics",
  "organizationId": "org-123",
  "licenseType": "commercial",
  "validFrom": "2024-01-01T00:00:00Z",
  "validUntil": "2025-01-01T00:00:00Z",
  "features": ["dashboard", "reports", "export"],
  "machineId": "specific-machine-id",
  "metadata": {
    "maxActivations": 1,
    "generatedBy": "admin@company.com"
  }
}
```

**Response:**
```json
{
  "success": true,
  "license": {
    "licenseId": "CB-6049-4392-892E-F67B-CDE8",
    "pluginId": "advanced-analytics",
    "status": "active",
    "validFrom": "2024-01-01T00:00:00Z",
    "validUntil": "2025-01-01T00:00:00Z",
    "createdAt": "2024-01-01T10:00:00Z"
  }
}
```

#### Validate License
```http
POST /api/licenses/validate
Content-Type: application/json

{
  "licenseKey": "CB-6049-4392-892E-F67B-CDE8",
  "pluginId": "advanced-analytics",
  "machineId": "CoreBridge-Prime-linux",
  "requestTime": "2024-01-01T10:00:00Z"
}
```

**Response (Valid):**
```json
{
  "valid": true,
  "license": {
    "licenseId": "CB-6049-4392-892E-F67B-CDE8",
    "status": "active",
    "validUntil": "2025-01-01T00:00:00Z",
    "features": ["dashboard", "reports", "export"]
  },
  "validation": {
    "timestamp": "2024-01-01T10:00:00Z",
    "machineMatch": true,
    "pluginMatch": true,
    "withinDateRange": true,
    "featureAccess": ["dashboard", "reports", "export"]
  }
}
```

**Response (Invalid):**
```json
{
  "valid": false,
  "error": "License has been revoked",
  "code": "LICENSE_REVOKED",
  "details": {
    "revokedAt": "2024-06-01T10:00:00Z",
    "revokedBy": "admin@company.com",
    "reason": "License violation detected"
  }
}
```

#### List Licenses
```http
GET /api/licenses?pluginId=advanced-analytics&status=active&page=1&limit=10
```

**Response:**
```json
{
  "licenses": [
    {
      "licenseId": "CB-6049-4392-892E-F67B-CDE8",
      "pluginId": "advanced-analytics",
      "status": "active",
      "machineId": "CoreBridge-Prime-linux",
      "validFrom": "2024-01-01T00:00:00Z",
      "validUntil": "2025-01-01T00:00:00Z",
      "lastValidation": "2024-06-08T22:33:45Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

#### Revoke License
```http
POST /api/licenses/CB-6049-4392-892E-F67B-CDE8/revoke
Content-Type: application/json

{
  "reason": "License violation detected",
  "revokedBy": "admin@company.com",
  "notifyPlugin": true
}
```

**Response:**
```json
{
  "success": true,
  "license": {
    "licenseId": "CB-6049-4392-892E-F67B-CDE8",
    "status": "revoked",
    "revokedAt": "2024-06-08T22:33:45Z",
    "revokedBy": "admin@company.com",
    "reason": "License violation detected"
  }
}
```

### Analytics & Reporting

#### License Usage Statistics
```http
GET /api/licenses/CB-6049-4392-892E-F67B-CDE8/usage
```

**Response:**
```json
{
  "license": {
    "licenseId": "CB-6049-4392-892E-F67B-CDE8",
    "pluginId": "advanced-analytics"
  },
  "usage": {
    "totalValidations": 245,
    "successfulValidations": 244,
    "failedValidations": 1,
    "lastValidation": "2024-06-08T22:33:45Z",
    "averageValidationsPerDay": 12.5,
    "activationHistory": [
      {
        "machineId": "CoreBridge-Prime-linux",
        "firstActivation": "2024-01-01T10:00:00Z",
        "lastSeen": "2024-06-08T22:33:45Z",
        "validationCount": 245
      }
    ]
  }
}
```

#### Audit Trail
```http
GET /api/licenses/CB-6049-4392-892E-F67B-CDE8/audit
```

**Response:**
```json
{
  "auditTrail": [
    {
      "auditId": 1,
      "action": "LICENSE_CREATED",
      "actor": "admin@company.com",
      "timestamp": "2024-01-01T10:00:00Z",
      "details": {
        "pluginId": "advanced-analytics",
        "validUntil": "2025-01-01T00:00:00Z"
      }
    },
    {
      "auditId": 2,
      "action": "LICENSE_VALIDATED",
      "actor": "system",
      "timestamp": "2024-06-08T22:33:45Z",
      "details": {
        "machineId": "CoreBridge-Prime-linux",
        "result": "valid"
      }
    }
  ]
}
```

## 🛠️ Plugin Integration Guide

### Step 1: Add License Dependencies

Add to your plugin's `package.json`:
```json
{
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

### Step 2: License Manager Service

Create `src/services/LicenseManager.js`:
```javascript
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class LicenseManager {
  constructor(pluginId) {
    this.pluginId = pluginId;
    this.licenseManagerUrl = process.env.LICENSE_MANAGER_URL || 
      'http://corebridge-license-manager:3008';
    this.configPath = path.join(__dirname, '../..', 'config.json');
    this.licenseKey = null;
    this.licenseValid = false;
    this.validationInterval = null;
  }

  async validateLicense(licenseKey) {
    try {
      const machineId = this.generateMachineId();
      const response = await axios.post(
        `${this.licenseManagerUrl}/api/licenses/validate`,
        {
          licenseKey,
          pluginId: this.pluginId,
          machineId,
          requestTime: new Date().toISOString()
        },
        { 
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('License validation failed:', error.message);
      return { 
        valid: false, 
        error: error.response?.data?.error || error.message 
      };
    }
  }

  generateMachineId() {
    const os = require('os');
    return `${os.hostname()}-${os.platform()}`;
  }

  loadConfiguration() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        return config;
      }
    } catch (error) {
      console.warn('Failed to load configuration:', error.message);
    }
    return {};
  }

  saveConfiguration(config) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save configuration:', error.message);
      return false;
    }
  }

  async promptForLicense() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      console.log('\n⚠️  License Required');
      console.log(`This plugin (${this.pluginId}) requires a valid license to operate.`);
      console.log('Please obtain a license key from your administrator.\n');
      
      rl.question('Enter license key: ', async (licenseKey) => {
        rl.close();
        
        if (!licenseKey.trim()) {
          console.error('License key is required. Plugin cannot start.');
          resolve(false);
          return;
        }

        const validation = await this.validateLicense(licenseKey.trim());
        
        if (validation.valid) {
          const config = this.loadConfiguration();
          config.licenseKey = licenseKey.trim();
          
          if (this.saveConfiguration(config)) {
            console.log('✅ License validated and saved successfully!');
            this.licenseKey = licenseKey.trim();
            this.licenseValid = true;
            resolve(true);
          } else {
            console.error('Failed to save license configuration.');
            resolve(false);
          }
        } else {
          console.error('❌ Invalid license:', validation.error);
          resolve(false);
        }
      });
    });
  }

  async initializeLicense() {
    const config = this.loadConfiguration();
    
    if (!config.licenseKey) {
      console.log('No license key found in configuration.');
      return await this.promptForLicense();
    }

    console.log('Validating existing license...');
    const validation = await this.validateLicense(config.licenseKey);
    
    if (validation.valid) {
      console.log('✅ License validated successfully!');
      this.licenseKey = config.licenseKey;
      this.licenseValid = true;
      this.startPeriodicValidation();
      return true;
    } else {
      console.error('❌ Existing license is invalid:', validation.error);
      console.log('Please provide a new license key.');
      return await this.promptForLicense();
    }
  }

  startPeriodicValidation() {
    // Validate license every hour
    this.validationInterval = setInterval(async () => {
      const validation = await this.validateLicense(this.licenseKey);
      
      if (!validation.valid) {
        console.error('🚨 License validation failed during periodic check:', validation.error);
        this.licenseValid = false;
        
        // Optional: Shut down plugin or restrict functionality
        if (validation.error === 'License has been revoked') {
          console.error('License has been revoked. Plugin will shut down.');
          process.exit(1);
        }
      } else {
        console.log('✅ Periodic license validation successful');
      }
    }, 3600000); // 1 hour
  }

  stopPeriodicValidation() {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
    }
  }

  async getStatus() {
    if (!this.licenseKey) {
      return {
        licenseValid: false,
        licenseStatus: 'required',
        message: 'No license key configured'
      };
    }

    const validation = await this.validateLicense(this.licenseKey);
    
    return {
      licenseValid: validation.valid,
      licenseStatus: validation.valid ? 'active' : validation.error,
      message: validation.valid ? 
        'License is valid and active' : 
        validation.error,
      licenseKey: this.licenseKey ? 
        `${this.licenseKey.substring(0, 8)}...${this.licenseKey.substring(this.licenseKey.length - 4)}` : 
        null
    };
  }

  async configureLicense(licenseKey) {
    const validation = await this.validateLicense(licenseKey);
    
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const config = this.loadConfiguration();
    config.licenseKey = licenseKey;
    
    if (!this.saveConfiguration(config)) {
      throw new Error('Failed to save license configuration');
    }

    this.licenseKey = licenseKey;
    this.licenseValid = true;
    
    // Start periodic validation if not already running
    if (!this.validationInterval) {
      this.startPeriodicValidation();
    }

    return validation;
  }
}

module.exports = LicenseManager;
```

### Step 3: License Middleware

Create `src/middleware/licenseMiddleware.js`:
```javascript
function requireLicense(req, res, next) {
  if (!global.licenseManager || !global.licenseManager.licenseValid) {
    return res.status(403).json({
      error: 'Valid license required',
      code: 'LICENSE_REQUIRED',
      message: 'This plugin requires a valid license to operate. Please configure a valid license key.',
      configure: '/api/license/configure'
    });
  }
  next();
}

function optionalLicense(req, res, next) {
  // Add license info to request for conditional features
  req.licenseValid = global.licenseManager?.licenseValid || false;
  next();
}

module.exports = { requireLicense, optionalLicense };
```

### Step 4: Plugin Integration

Update your main `src/index.js`:
```javascript
const express = require('express');
const LicenseManager = require('./services/LicenseManager');
const { requireLicense, optionalLicense } = require('./middleware/licenseMiddleware');

const app = express();
app.use(express.json());

// Initialize license manager
const licenseManager = new LicenseManager('your-plugin-id');
global.licenseManager = licenseManager;

// License management routes
app.get('/api/license/status', async (req, res) => {
  try {
    const status = await licenseManager.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/license/configure', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ error: 'License key is required' });
    }

    const validation = await licenseManager.configureLicense(licenseKey);
    res.json({ 
      success: true, 
      message: 'License configured successfully',
      validation 
    });
  } catch (error) {
    res.status(400).json({ 
      error: error.message,
      code: 'LICENSE_CONFIGURATION_FAILED'
    });
  }
});

// Protected routes (require license)
app.use('/api/premium', requireLicense);
app.get('/api/premium/features', (req, res) => {
  res.json({ 
    message: 'Premium features available',
    features: ['advanced-analytics', 'custom-reports', 'data-export']
  });
});

// Optional license routes (features available based on license)
app.use('/api/conditional', optionalLicense);
app.get('/api/conditional/features', (req, res) => {
  const features = ['basic-feature'];
  
  if (req.licenseValid) {
    features.push('premium-feature', 'advanced-feature');
  }
  
  res.json({ 
    features,
    licensed: req.licenseValid
  });
});

// Health check (always available)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    licensed: global.licenseManager?.licenseValid || false
  });
});

// Startup function
async function startPlugin() {
  try {
    console.log('Starting plugin with license validation...');
    
    // Initialize license
    const licenseInitialized = await licenseManager.initializeLicense();
    
    if (!licenseInitialized) {
      console.error('❌ Failed to initialize license. Plugin cannot start.');
      process.exit(1);
    }

    const PORT = process.env.PORT || 3007;
    app.listen(PORT, () => {
      console.log(`🚀 Licensed plugin running on port ${PORT}`);
      console.log(`📊 License status: ${licenseManager.licenseValid ? 'Valid' : 'Invalid'}`);
    });

  } catch (error) {
    console.error('Failed to start plugin:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  if (global.licenseManager) {
    global.licenseManager.stopPeriodicValidation();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  if (global.licenseManager) {
    global.licenseManager.stopPeriodicValidation();
  }
  process.exit(0);
});

startPlugin();
```

## 🔧 Configuration

### Environment Variables

The License Manager supports the following environment variables:

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=corebridge
DB_USER=corebridge
DB_PASSWORD=your_password

# License Manager Configuration
LICENSE_MANAGER_PORT=3008
LICENSE_KEY_PREFIX=CB
LICENSE_DEFAULT_VALIDITY_DAYS=365

# Security Configuration
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:4001

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=/app/logs/license-manager.log
```

### Database Configuration

Ensure your PostgreSQL database is properly configured:

```sql
-- Create database user
CREATE USER corebridge WITH PASSWORD 'your_password';

-- Create database
CREATE DATABASE corebridge OWNER corebridge;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE corebridge TO corebridge;
```

## 🚨 Troubleshooting

### Common Issues

#### License Validation Failures

**Issue**: Plugin receives "LICENSE_REQUIRED" error
**Solution**: 
1. Check license key validity
2. Verify plugin ID matches license
3. Confirm machine ID binding
4. Check license expiration date

#### Database Connection Issues

**Issue**: License Manager fails to start with database errors
**Solution**:
1. Verify PostgreSQL is running
2. Check database credentials
3. Ensure database exists and is accessible
4. Review network connectivity

#### Network Connectivity

**Issue**: Plugin cannot reach License Manager
**Solution**:
1. Verify License Manager is running on correct port
2. Check Docker network configuration
3. Confirm firewall settings
4. Test connectivity with curl

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=debug
npm start
```

### Health Monitoring

Monitor license validation health:
```bash
# Check License Manager health
curl http://localhost:3008/health

# Check plugin license status
curl http://localhost:3007/api/license/status

# View recent license validations
curl http://localhost:3008/api/licenses/recent-validations
```

## 📈 Monitoring & Analytics

### License Usage Metrics

The License Manager provides comprehensive metrics:

- **Validation Frequency**: Track license validation patterns
- **Plugin Activation**: Monitor plugin activation and deactivation
- **License Utilization**: Understand license usage across plugins
- **Error Rates**: Monitor validation failures and issues
- **Geographic Distribution**: Track license usage by location (if configured)

### Audit Trail

All license operations are logged with:
- **Action Type**: Creation, validation, revocation, modification
- **Actor**: User or system performing the action
- **Timestamp**: Precise time of operation
- **IP Address**: Source IP for security tracking
- **User Agent**: Client information for validation requests
- **Details**: Comprehensive operation metadata

## 🔐 Security Considerations

### License Key Security
- License keys are generated using cryptographically secure random data
- Keys include checksums to prevent tampering
- Machine binding prevents unauthorized transfers

### Communication Security
- All license validation uses HTTPS in production
- Request signing prevents replay attacks
- Rate limiting prevents abuse

### Audit Security
- Audit trails are tamper-evident
- Comprehensive logging for compliance
- Regular audit trail backups recommended

## 📋 Best Practices

### For Plugin Developers
1. **Graceful Degradation**: Handle license failures gracefully without crashing
2. **User Communication**: Provide clear license status and renewal information
3. **Periodic Validation**: Validate licenses regularly during operation
4. **Error Handling**: Implement comprehensive license error handling
5. **Testing**: Test all license scenarios including expiration and revocation

### For System Administrators
1. **License Monitoring**: Set up alerts for license expiration and failures
2. **Backup Procedures**: Regular backup of license database
3. **Security Updates**: Keep License Manager updated with security patches
4. **Audit Reviews**: Regular review of audit trails for compliance
5. **Renewal Planning**: Proactive license renewal management

## 🔗 Related Documentation

- [CoreBridge Licensing System Overview](../../docs/licensing-system.md)
- [Plugin Development Guide](../../docs/plugin-system.md)
- [API Reference Documentation](../../docs/api/)
- [Deployment Guide](../../docs/deployment-guide.md)
- [Troubleshooting Guide](../../docs/troubleshooting.md)

## 📞 Support

For technical support and license management assistance:

- **Documentation**: Comprehensive guides in `/docs` directory
- **API Reference**: Interactive API documentation at `/api/docs`
- **Health Monitoring**: Real-time system status at `/health`
- **Audit Trails**: Complete operation history in license dashboard

The CoreBridge License Manager provides enterprise-grade licensing capabilities while maintaining ease of use and comprehensive security features. 