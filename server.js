const express = require('express');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;
const DATA_FILE = path.join(__dirname, 'school_devices.json');

// Middleware
app.use(express.json());

// Initialize data structure
let schoolData = {};

// Load existing data from file on server start
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        schoolData = JSON.parse(data);
        console.log('Data loaded from file successfully');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No existing data file found. Starting with empty data.');
            schoolData = {};
        } else {
            console.error('Error loading data:', error);
            schoolData = {};
        }
    }
}

// Save data to file
async function saveData() {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(schoolData, null, 2));
        console.log('Data saved to file successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next(); // move to the next middleware or route handler
});

// API endpoint to register/get host devices
app.post('/api/get-hosts', async (req, res) => {
    try {
        const { schoolCode, deviceId } = req.body;

        // Validate input
        if (!schoolCode || !deviceId) {
            return res.status(400).json({
                success: false,
                message: 'School code and device ID are required'
            });
        }

        // Initialize school if it doesn't exist
        if (!schoolData[schoolCode]) {
            schoolData[schoolCode] = {
                devices: [],
                hosts: []
            };
        }

        const school = schoolData[schoolCode];
        
        // Check if device already exists
        const existingDeviceIndex = school.devices.findIndex(device => device.deviceId === deviceId);
        
        if (existingDeviceIndex === -1) {
            // New device - add to the list
            school.devices.push({
                deviceId: deviceId,
                registeredAt: new Date().toISOString()
            });

            // Update hosts list (max 3 hosts)
            if (school.hosts.length < 3) {
                school.hosts.push(deviceId);
            }
        }

        // Prepare response based on current device position
        const deviceIndex = school.devices.findIndex(device => device.deviceId === deviceId);
        const response = {
            success: true,
            schoolCode: schoolCode,
            deviceId: deviceId,
            position: deviceIndex + 1,
            totalDevices: school.devices.length
        };

        // Determine response based on device position
        if (deviceIndex === 0) {
            // First device (Host 1)
            response.hostDeviceId = deviceId;
            response.role = 'host1';
            response.message = 'You are the primary host';
        } else if (deviceIndex === 1) {
            // Second device (Host 2)
            response.hostDeviceId = school.hosts[0]; // Return first host
            response.host2DeviceId = deviceId;
            response.role = 'host2';
            response.message = 'You are the secondary host';
        } else if (deviceIndex === 2) {
            // Third device (Host 3)
            response.hostDeviceId = school.hosts[0]; // Return first host
            response.host2DeviceId = school.hosts[1]; // Return second host
            response.host3DeviceId = deviceId;
            response.role = 'host3';
            response.message = 'You are the tertiary host';
        } else {
            // Fourth device onwards (Client devices)
            response.hostDeviceId = school.hosts[0]; // Host 1
            response.host2DeviceId = school.hosts[1]; // Host 2
            response.host3DeviceId = school.hosts[2]; // Host 3
            response.role = 'client';
            response.message = 'You are a client device';
        }

        // Add all hosts to response for clarity
        response.hosts = {
            host1: school.hosts[0] || null,
            host2: school.hosts[1] || null,
            host3: school.hosts[2] || null
        };

        // Save data to file
        await saveData();

        console.log(response);

        return res.json(response);

    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// API endpoint to get school information
app.get('/api/school/:schoolCode', (req, res) => {
    try {
        const { schoolCode } = req.params;
        
        if (!schoolData[schoolCode]) {
            return res.status(404).json({
                success: false,
                message: 'School not found'
            });
        }

        const school = schoolData[schoolCode];
        res.json({
            success: true,
            schoolCode: schoolCode,
            totalDevices: school.devices.length,
            hosts: school.hosts,
            devices: school.devices
        });

    } catch (error) {
        console.error('Error getting school info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// API endpoint to reset school data (for testing purposes)
app.delete('/api/school/:schoolCode', async (req, res) => {
    try {
        const { schoolCode } = req.params;
        
        if (schoolData[schoolCode]) {
            delete schoolData[schoolCode];
            await saveData();
            
            res.json({
                success: true,
                message: `School ${schoolCode} data reset successfully`
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'School not found'
            });
        }

    } catch (error) {
        console.error('Error resetting school data:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Ping pong endpoint
app.get('/ping', (req, res) => {
    res.json({
        success: true,
        message: 'Pong',
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server
async function startServer() {
    try {
        await loadData();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`Main API: POST http://localhost:${PORT}/api/get-hosts`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// const express = require("express");
// const app = express();

// app.listen(3333,() => {
//     console.log("Running the app");
// });