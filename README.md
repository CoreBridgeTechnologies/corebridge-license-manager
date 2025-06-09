# Corebridge License Manager Template

This is a template plugin for CoreBridge that demonstrates best practices for plugin development and integration with the CoreBridge auto-discovery system.

## Overview

The Corebridge License Manager demonstrates:
- ✅ Required health check endpoints
- ✅ Proper manifest configuration
- ✅ Core API integration
- ✅ Error handling and graceful shutdown
- ✅ Request tracking and metrics
- ✅ Docker networking considerations

## Quick Start

### 1. Copy Template

```bash
# Use the automated script (recommended)
./scripts/create-plugin.sh my-new-plugin 3008

# Or copy manually
cp -r docs/plugin-template plugins/my-new-plugin
cd plugins/my-new-plugin
```

### 2. Customize Plugin

Edit the following files:

**plugin.json**
```json
{
  "id": "my-new-plugin",
  "name": "My New Plugin", 
  "description": "Description of what your plugin does",
  "port": 3008,
  // ... other settings
}
```

**docker-compose.yml**
```yaml
services:
  my-new-plugin:
    build: .
    container_name: corebridge-my-new-plugin
    ports:
      - "3008:3008"
    # ... update service name and ports
```

**src/index.js**
```javascript
const PLUGIN_ID = 'my-new-plugin';
const PORT = process.env.PORT || 3008;
// ... customize your plugin logic
```

### 3. Build and Test Container

```bash
# Install dependencies
npm install

# Build Docker image
npm run docker:build

# Test container locally
docker run --rm -p 3008:3008 --name test-plugin corebridge-my-new-plugin

# Test health endpoint
curl http://localhost:3008/health
```

### 4. Deploy with CoreBridge

```bash
# Start plugin container with CoreBridge network
npm run docker:compose:up

# Check logs
npm run docker:compose:logs

# Verify plugin is running
docker ps | grep my-new-plugin
```

### 5. Verify Discovery

```bash
# Check if plugin is discovered
curl http://localhost:4001/api/plugins/discover

# Enable your plugin
curl -X POST http://localhost:4001/api/plugins/my-new-plugin/enable
```

## Plugin Structure

```
my-new-plugin/
├── plugin.json         # Plugin manifest (required)
├── package.json        # Node.js package config (required)
├── README.md          # Plugin documentation
├── src/
│   └── index.js       # Main plugin code (required)
└── docs/              # Additional documentation
    └── api.md
```

## Required Endpoints

Your plugin must implement these endpoints:

### Health Check
```
GET /health
```
Returns plugin health status. Must return 200 for healthy, 503 for unhealthy.

### Status Check
```
GET /status
```
Returns basic plugin status and uptime information.

### Optional Metrics
```
GET /metrics
```
Returns detailed plugin metrics and performance data.

## Plugin Manifest

The `plugin.json` file is required and must include:

### Required Fields
- `id`: Unique plugin identifier
- `name`: Human-readable plugin name
- `description`: Brief description
- `version`: Semantic version
- `port`: Port number to listen on

### Optional Fields
- `category`: Plugin category for organization
- `tags`: Array of searchable tags
- `endpoints`: Custom endpoint paths
- `dependencies`: Required dependencies
- `permissions`: System permissions needed

## Core API Integration

Your plugin can communicate with CoreBridge core:

```javascript
const CORE_API_BASE = 'http://172.20.0.1:4001/api';

// Send health updates
await axios.post(`${CORE_API_BASE}/health/update`, {
  pluginId: 'my-plugin',
  status: 'healthy',
  metrics: { ... }
});

// Register plugin (optional, auto-discovery handles this)
await axios.post(`${CORE_API_BASE}/plugins/register`, {
  pluginId: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  port: 3008
});
```

## Development Workflow

### 1. Development Mode

```bash
# Start with auto-reload
npm run dev

# Or start normally
npm start
```

### 2. Testing

```bash
# Test health endpoint
curl http://localhost:3008/health

# Test status endpoint
curl http://localhost:3008/status

# Test custom endpoints
curl http://localhost:3008/api/info
curl http://localhost:3008/api/data
curl -X POST http://localhost:3008/api/echo -H "Content-Type: application/json" -d '{"test": "data"}'
```

### 3. CoreBridge Integration

```bash
# Force plugin discovery
curl http://localhost:4001/api/plugins/discover

# Check if plugin is found
curl http://localhost:4001/api/plugins | jq '.data[] | select(.id=="my-new-plugin")'

# Enable plugin
curl -X POST http://localhost:4001/api/plugins/my-new-plugin/enable

# Check plugin health
curl -X POST http://localhost:4001/api/plugins/my-new-plugin/health
```

## Best Practices

### 1. Error Handling

```javascript
// Use try-catch for async operations
app.get('/api/data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});
```

### 2. Health Checks

```javascript
app.get('/health', (req, res) => {
  const checks = {
    database: checkDatabase(),
    external_api: checkExternalAPI(),
    memory: checkMemoryUsage()
  };

  const isHealthy = Object.values(checks).every(check => check === true);
  const status = isHealthy ? 'healthy' : 'unhealthy';
  const httpStatus = isHealthy ? 200 : 503;

  res.status(httpStatus).json({
    status,
    checks,
    timestamp: new Date().toISOString()
  });
});
```

### 3. Graceful Shutdown

```javascript
const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    // Clean up resources
    console.log('Plugin stopped successfully');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### 4. Request Validation

```javascript
const validateRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      error: 'Invalid request body',
      timestamp: new Date().toISOString()
    });
  }
  next();
};

app.post('/api/data', validateRequest, (req, res) => {
  // Handle validated request
});
```

## Networking Notes

### Docker Gateway

- CoreBridge core runs in Docker container
- Plugins run on host system
- Core accesses plugins via Docker gateway IP: `172.20.0.1`
- Plugins access core via: `http://172.20.0.1:4001/api`

### Port Management

- Each plugin needs unique port
- Default ports: 3002 (health-monitor), 3008+ (other plugins)
- Listen on all interfaces: `0.0.0.0`

```javascript
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Plugin started on port ${PORT}`);
});
```

## Troubleshooting

### Plugin Not Discovered

1. Check `plugin.json` syntax
2. Verify plugin is in `plugins/` directory
3. Check CoreBridge logs: `docker logs corebridge-core`

### Health Check Failing

1. Verify plugin is running: `curl http://localhost:3008/health`
2. Check network connectivity from Docker container
3. Ensure health endpoint returns 200 status

### Plugin Shows as Stopped

1. Confirm plugin process is running: `ps aux | grep node`
2. Check port conflicts: `lsof -i :3008`
3. Verify Docker gateway access: `curl http://172.20.0.1:3008/health`

## API Endpoints

This template includes these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (required) |
| `/status` | GET | Status information (required) |
| `/metrics` | GET | Plugin metrics (optional) |
| `/api/info` | GET | Plugin information |
| `/api/data` | GET | Sample data endpoint |
| `/api/echo` | POST | Echo request body |

## Next Steps

1. **Customize the template** for your specific use case
2. **Implement your business logic** in the API endpoints
3. **Add additional endpoints** as needed
4. **Update documentation** to reflect your plugin's functionality
5. **Test thoroughly** before deployment

## Reference

- [CoreBridge Plugin System Documentation](../plugin-system.md)
- [Health Monitor Plugin](../../plugins/health-monitor/) - Reference implementation
- [CoreBridge Development Guide](../development-guide.md) 