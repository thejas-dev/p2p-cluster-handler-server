const express = require('express');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'school_clusters.json');

// Configuration
const MAX_DEVICES_PER_CLUSTER = 10;
const MAX_HOSTS_PER_CLUSTER = 3;

// WiFi 5GHz frequency channels (in MHz)
const FREQUENCY_CHANNELS = [
    5180, 5200, 5220, 5240, 5260, 5280, 5300, 5320,
    5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640,
    5660, 5680, 5700, 5720, 5745, 5765, 5785, 5805, 5825
];

// Helper function to get random frequency channel
function getRandomFrequency() {
    return FREQUENCY_CHANNELS[Math.floor(Math.random() * FREQUENCY_CHANNELS.length)];
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Helper function to find or create appropriate cluster
function findOrCreateCluster(schoolCode, deviceId) {
    // Initialize school if it doesn't exist
    if (!schoolData[schoolCode]) {
        schoolData[schoolCode] = {
            clusters: {},
            totalDevices: 0,
            lastClusterNumber: 0
        };
    }

    const school = schoolData[schoolCode];

    // Check if device already exists in any cluster
    for (const clusterName in school.clusters) {
        const cluster = school.clusters[clusterName];
        const existingDevice = cluster.devices.find(device => device.deviceId === deviceId);
        if (existingDevice) {
            return {
                clusterName: clusterName,
                cluster: cluster,
                isExisting: true
            };
        }
    }

    // Device doesn't exist, find a cluster with space or create new one
    for (const clusterName in school.clusters) {
        const cluster = school.clusters[clusterName];
        if (cluster.devices.length < MAX_DEVICES_PER_CLUSTER) {
            return {
                clusterName: clusterName,
                cluster: cluster,
                isExisting: false
            };
        }
    }

    // All clusters are full, create a new cluster
    school.lastClusterNumber += 1;
    const newClusterName = `${schoolCode}_${school.lastClusterNumber}`;
    school.clusters[newClusterName] = {
        clusterNumber: school.lastClusterNumber,
        devices: [],
        hosts: [],
      frequency: getRandomFrequency(),
      createdAt: new Date().toISOString(),
    };

    return {
        clusterName: newClusterName,
        cluster: school.clusters[newClusterName],
        isExisting: false
    };
}

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

        // Find or create appropriate cluster
        const { clusterName, cluster, isExisting } = findOrCreateCluster(schoolCode, deviceId);

        if (!isExisting) {
            // Add new device to cluster
            cluster.devices.push({
                deviceId: deviceId,
                registeredAt: new Date().toISOString()
            });

            // Update hosts list (max 3 hosts per cluster)
            if (cluster.hosts.length < MAX_HOSTS_PER_CLUSTER) {
                cluster.hosts.push(deviceId);
            }

            // Update school total devices count
            schoolData[schoolCode].totalDevices += 1;
        }

        // Find device position in cluster
        const deviceIndex = cluster.devices.findIndex(device => device.deviceId === deviceId);
        
        // Prepare response based on current device position in cluster
        const response = {
            success: true,
            schoolCode: schoolCode,
            clusterName: clusterName,
            clusterNumber: cluster.clusterNumber,
            deviceId: deviceId,
            positionInCluster: deviceIndex + 1,
            totalDevicesInCluster: cluster.devices.length,
            totalDevicesInSchool: schoolData[schoolCode].totalDevices,
          maxDevicesPerCluster: MAX_DEVICES_PER_CLUSTER,
          frequency: cluster.frequency,
        };

        // Determine response based on device position in cluster
        if (deviceIndex === 0) {
            // First device in cluster (Host 1)
            response.hostDeviceId = deviceId;
            response.role = 'host1';
            response.message = `You are the primary host for cluster ${clusterName}`;
        } else if (deviceIndex === 1) {
            // Second device in cluster (Host 2)
            response.hostDeviceId = cluster.hosts[0]; // Return first host
            response.host2DeviceId = deviceId;
            response.role = 'host2';
            response.message = `You are the secondary host for cluster ${clusterName}`;
        } else if (deviceIndex === 2) {
            // Third device in cluster (Host 3)
            response.hostDeviceId = cluster.hosts[0]; // Return first host
            response.host2DeviceId = cluster.hosts[1]; // Return second host
            response.host3DeviceId = deviceId;
            response.role = 'host3';
            response.message = `You are the tertiary host for cluster ${clusterName}`;
        } else {
            // Fourth device onwards in cluster (Client devices)
            response.hostDeviceId = cluster.hosts[0]; // Host 1
            response.host2DeviceId = cluster.hosts[1]; // Host 2
            response.host3DeviceId = cluster.hosts[2]; // Host 3
            response.role = 'client';
            response.message = `You are a client device in cluster ${clusterName}`;
        }

        // Add all hosts in cluster to response for clarity
        response.clusterHosts = {
            host1: cluster.hosts[0] || null,
            host2: cluster.hosts[1] || null,
            host3: cluster.hosts[2] || null
        };

        // Add cluster devices list
        response.clusterDevices = cluster.devices.map(device => device.deviceId);

        // Save data to file
        await saveData();

        res.json(response);

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
        
        // Prepare cluster summary
        const clusterSummary = {};
        for (const clusterName in school.clusters) {
            const cluster = school.clusters[clusterName];
            clusterSummary[clusterName] = {
                clusterNumber: cluster.clusterNumber,
                totalDevices: cluster.devices.length,
                hosts: cluster.hosts,
                devices: cluster.devices.map(device => device.deviceId),
                isFull: cluster.devices.length >= MAX_DEVICES_PER_CLUSTER,
                createdAt: cluster.createdAt,
                frequency: cluster.frequency,
            };
        }

        res.json({
            success: true,
            schoolCode: schoolCode,
            totalDevices: school.totalDevices,
            totalClusters: Object.keys(school.clusters).length,
            lastClusterNumber: school.lastClusterNumber,
            maxDevicesPerCluster: MAX_DEVICES_PER_CLUSTER,
            clusters: clusterSummary
        });

    } catch (error) {
        console.error('Error getting school info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// API endpoint to get specific cluster information
app.get('/api/school/:schoolCode/cluster/:clusterNumber', (req, res) => {
    try {
        const { schoolCode, clusterNumber } = req.params;
        
        if (!schoolData[schoolCode]) {
            return res.status(404).json({
                success: false,
                message: 'School not found'
            });
        }

        const clusterName = `${schoolCode}_${clusterNumber}`;
        const cluster = schoolData[schoolCode].clusters[clusterName];

        if (!cluster) {
            return res.status(404).json({
                success: false,
                message: 'Cluster not found'
            });
        }

        res.json({
            success: true,
            schoolCode: schoolCode,
            clusterName: clusterName,
            clusterNumber: cluster.clusterNumber,
            totalDevices: cluster.devices.length,
            maxDevices: MAX_DEVICES_PER_CLUSTER,
            isFull: cluster.devices.length >= MAX_DEVICES_PER_CLUSTER,
            hosts: cluster.hosts,
            devices: cluster.devices,
            createdAt: cluster.createdAt,
            frequency: cluster.frequency,
        });

    } catch (error) {
        console.error('Error getting cluster info:', error);
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

// API endpoint to reset specific cluster data
app.delete('/api/school/:schoolCode/cluster/:clusterNumber', async (req, res) => {
    try {
        const { schoolCode, clusterNumber } = req.params;
        
        if (!schoolData[schoolCode]) {
            return res.status(404).json({
                success: false,
                message: 'School not found'
            });
        }

        const clusterName = `${schoolCode}_${clusterNumber}`;
        const cluster = schoolData[schoolCode].clusters[clusterName];

        if (!cluster) {
            return res.status(404).json({
                success: false,
                message: 'Cluster not found'
            });
        }

        // Update school total devices count
        schoolData[schoolCode].totalDevices -= cluster.devices.length;
        
        // Remove cluster
        delete schoolData[schoolCode].clusters[clusterName];
        
        await saveData();
        
        res.json({
            success: true,
            message: `Cluster ${clusterName} reset successfully`
        });

    } catch (error) {
        console.error('Error resetting cluster data:', error);
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
        timestamp: new Date().toISOString(),
        config: {
            maxDevicesPerCluster: MAX_DEVICES_PER_CLUSTER,
            maxHostsPerCluster: MAX_HOSTS_PER_CLUSTER
        }
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
            console.log(`Max devices per cluster: ${MAX_DEVICES_PER_CLUSTER}`);
            console.log(`Max hosts per cluster: ${MAX_HOSTS_PER_CLUSTER}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();