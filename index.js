import ZKLib from 'node-zklib';
import fetch from 'node-fetch';
import { getBranches } from "./branches.js";

// Store last fetch time for each device to avoid reprocessing all logs
const lastFetchTimes = {};

const fetchAllBranchesPunches = async () => {
    const branches = await getBranches();
    for (const branch of branches) {
        try {
            await fetchBranchPunches(branch);
        } catch (error) {
            console.error(`❌ Error fetching punches for branch ${branch.id} (IP: ${branch.ip}):`, error.message || error);
            // Consider more advanced error handling, like retries or notifications
        }
    }
};

const fetchBranchPunches = async (branch) => {
    const { id, ip } = branch;
    const zkInstance = new ZKLib(ip, 4370, 5200, 5000);

    try {
        await zkInstance.createSocket();

        // Use a branch-specific lastFetchTime
        const lastFetchTime = lastFetchTimes[id] || null;

        const allLogs = (await zkInstance.getAttendances()).data;

        const newLogs = allLogs.filter(log => {
            const logTime = new Date(log.recordTime);
            return !lastFetchTime || logTime > lastFetchTime;
        });

        if (newLogs.length > 0) {
            console.log(`🔔 New Punches found for Branch ${id} @ ${new Date().toLocaleString()}`);

            // Send new logs to your Next.js API
            await sendPunchesToApi(newLogs, id);

            // Update last fetch time for this specific branch
            lastFetchTimes[id] = new Date(newLogs[newLogs.length - 1].recordTime);
        } else {
            console.log(`⏱ No new punches found for Branch ${id}.`);
        }

        await zkInstance.disconnect();
    } catch (err) {
        console.error(`❌ Error with ZKLib for branch ${id} (IP: ${ip}):`, err.message || err);
        // You might want to skip this branch and continue with others
    }
};

const sendPunchesToApi = async (punches, branchId) => {
    const API_URL = process.env.PUNCH_URL;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // in future might add an API key for security, e.g., 'X-API-Key': process.env.INGEST_API_KEY
            },
            // sending the branchId (which is your tenantId)
            // along with the raw punch data.
            body: JSON.stringify({ punches, tenantId: process.env.TENANT_ID }),
        });

        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }

        console.log(`✅ Successfully sent ${punches.length} new punches to the API for tenant ${branchId}.`);

    } catch (error) {
        console.error(`❌ Failed to send punches to Next.js API for tenant ${branchId}:`, error.message);
    }
};

// Start the process
fetchAllBranchesPunches();
setInterval(fetchAllBranchesPunches, 5 * 1000); // Check every 5 seconds
