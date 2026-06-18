const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const VALVE_OPEN_COMMAND = 'OFF';
const VALVE_CLOSED_COMMAND = 'ON';

let client;
const clientId = 'WaterTech_Web_' + Math.random().toString(16).substring(2, 8);

let currentFlow = 0.0;
let localConsumptionDaily = 0.0;
let localConsumptionWeekly = 0.0;
let lastFlowTimestamp = null;

const MAX_FLOW = 25.0; 

const dailyLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dailyData = [120, 145, 98, 115, 130, 85, 0];

const weeklyLabels = ['Semana 22', 'Semana 23', 'Semana 24', 'Semana 25'];
const weeklyData = [780, 850, 920, 0];

let activeChartType = 'daily';
let consumptionChart = null;

const flowValEl = document.getElementById('flow-val');
const pulsesValEl = document.getElementById('pulses-val');
const pressureValEl = document.getElementById('pressure-val');
const gaugeFill = document.getElementById('gauge-fill');

const valveSwitch = document.getElementById('valve-switch');
const valveStatusLabel = document.getElementById('valve-status-label');
// const pumpSwitch = document.getElementById('pump-switch');
// const pumpStatusLabel = document.getElementById('pump-status-label');

const consumptionDailyEl = document.getElementById('consumption-daily');
const consumptionWeeklyEl = document.getElementById('consumption-weekly');

const alertBanner = document.getElementById('alert-banner');
const alertMsgEl = document.getElementById('alert-msg');
const closeAlertBtn = document.getElementById('close-alert-btn');
const alertsLogTbody = document.getElementById('alerts-log-tbody');

const btnChartDaily = document.getElementById('btn-chart-daily');
const btnChartWeekly = document.getElementById('btn-chart-weekly');
const mqttStatusBadge = document.getElementById('mqtt-status');

document.addEventListener('DOMContentLoaded', () => {
    initMQTT();
    initChart();
    setupEventListeners();
});

function initMQTT() {
    updateMQTTStatus('disconnected');

    console.log('Conectando a broker MQTT:', BROKER_URL);
    client = mqtt.connect(BROKER_URL, {
        clientId: clientId,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 2000
    });

    client.on('connect', () => {
        console.log('¡Conectado con éxito a MQTT!');
        updateMQTTStatus('connected');

        client.subscribe('casa/agua/caudal', (err) => {
            if (!err) console.log('Suscrito a: casa/agua/caudal');
        });
        client.subscribe('casa/agua/estado', (err) => {
            if (!err) console.log('Suscrito a: casa/agua/estado');
        });
        client.subscribe('casa/agua/alerta', (err) => {
            if (!err) console.log('Suscrito a: casa/agua/alerta');
        });
        client.subscribe('casa/agua/consumo_procesado', (err) => {
            if (!err) console.log('Suscrito a: casa/agua/consumo_procesado');
        });
    });

    client.on('message', (topic, message, packet) => {
        const payloadString = message.toString();
        
        try {
            if (topic === 'casa/agua/caudal') {
                const data = JSON.parse(payloadString);
                handleCaudal(data);
            } else if (topic === 'casa/agua/estado') {
                if (packet?.retain) {
                    console.warn('Ignorando estado retenido de válvula:', payloadString);
                    return;
                }
                const data = JSON.parse(payloadString);
                handleEstado(data);
            } else if (topic === 'casa/agua/alerta') {
                handleAlerta(payloadString);
            } else if (topic === 'casa/agua/consumo_procesado') {
                const data = JSON.parse(payloadString);
                handleConsumoProcesado(data);
            }
        } catch (e) {
            console.error('Error procesando mensaje MQTT en topic:', topic, e);
        }
    });

    client.on('close', () => {
        console.warn('Conexión MQTT cerrada.');
        updateMQTTStatus('disconnected');
    });

    client.on('error', (err) => {
        console.error('Error de conexión MQTT:', err);
        updateMQTTStatus('disconnected');
    });
}

function updateMQTTStatus(status) {
    const iconEl = mqttStatusBadge.querySelector('.material-symbols-outlined');
    const textEl = mqttStatusBadge.querySelector('.status-text');
    if (status === 'connected') {
        mqttStatusBadge.className = 'flex items-center gap-2 text-status-success font-semibold text-xs py-1 px-3 bg-status-success/10 rounded-full';
        if (iconEl) {
            iconEl.textContent = 'wifi';
            iconEl.className = 'material-symbols-outlined text-[16px]';
        }
        if (textEl) textEl.textContent = 'Conectado';
    } else {
        mqttStatusBadge.className = 'flex items-center gap-2 text-status-error font-semibold text-xs py-1 px-3 bg-status-error/10 rounded-full';
        if (iconEl) {
            iconEl.textContent = 'wifi_off';
            iconEl.className = 'material-symbols-outlined text-[16px] animate-pulse';
        }
        if (textEl) textEl.textContent = 'Desconectado';
    }
}

function handleCaudal(data) {
    currentFlow = parseFloat(data.flow_l_min) || 0.0;
    const pulses = data.pulses || 0;
    
    flowValEl.textContent = currentFlow.toFixed(1);
    pulsesValEl.textContent = pulses;
    
    updateGauge(currentFlow);

    if (currentFlow > 18.0) {
        pressureValEl.textContent = 'Alto Flujo';
        pressureValEl.className = 'text-status-error font-bold';
    } else if (currentFlow > 0.1) {
        pressureValEl.textContent = 'Normal';
        pressureValEl.className = 'text-primary font-bold';
    } else {
        pressureValEl.textContent = 'Sin flujo';
        pressureValEl.className = 'text-on-surface-variant font-bold';
    }

    const ahora = Date.now();
    if (lastFlowTimestamp && (ahora - lastFlowTimestamp < 5000)) {
        const deltaSeconds = (ahora - lastFlowTimestamp) / 1000.0;
        const litros = currentFlow * (deltaSeconds / 60.0);
        
        localConsumptionDaily += litros;
        localConsumptionWeekly += litros;

        if (!hasProcessedConsumptionDataRecently()) {
            updateConsumptionUI(localConsumptionDaily, localConsumptionWeekly);
        }
    }
    lastFlowTimestamp = ahora;
}

function handleEstado(data) {
    const valveOpen = (data.valvula === VALVE_OPEN_COMMAND);
    valveSwitch.checked = valveOpen;
    if (valveOpen) {
        valveStatusLabel.textContent = 'Abierta';
        valveStatusLabel.className = 'text-[11px] font-semibold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded';
    } else {
        valveStatusLabel.textContent = 'Cerrada';
        valveStatusLabel.className = 'text-[11px] font-semibold text-on-surface-variant bg-slate-100 px-1.5 py-0.5 rounded';
    }

    // const pumpOn = (data.bomba === 'ON');
    // pumpSwitch.checked = pumpOn;
    // if (pumpOn) {
    //     pumpStatusLabel.textContent = 'Encendida';
    //     pumpStatusLabel.className = 'text-[11px] font-semibold text-status-success bg-status-success/10 px-1.5 py-0.5 rounded';
    // } else {
    //     pumpStatusLabel.textContent = 'Apagada';
    //     pumpStatusLabel.className = 'text-[11px] font-semibold text-on-surface-variant bg-slate-100 px-1.5 py-0.5 rounded';
    // }
}

function handleAlerta(alertType) {
    let msg = '';
    let severity = 'severity-high';
    
    if (alertType === 'Fuga_detectada_valvula_cerrada') {
        msg = 'Fuga detectada: ¡Paso de agua detectado con la válvula cerrada!';
    } else if (alertType === 'Fuga_Tiempo_Excesivo') {
        msg = 'Fuga crítica por flujo prolongado. Equipos desconectados por seguridad.';
    } else {
        msg = 'Alerta recibida: ' + alertType;
        severity = 'severity-warn';
    }

    alertMsgEl.textContent = msg;
    alertBanner.classList.remove('hidden');

    addAlertToLog(alertType, msg, severity);
}

let lastProcessedConsumptionTime = 0;
function handleConsumoProcesado(data) {
    lastProcessedConsumptionTime = Date.now();
    
    const daily = data.consumoDiarioL || 0.0;
    const weekly = data.consumoSemanalL || 0.0;
    
    updateConsumptionUI(daily, weekly);
    
    localConsumptionDaily = daily;
    localConsumptionWeekly = weekly;
}

function hasProcessedConsumptionDataRecently() {
    return (Date.now() - lastProcessedConsumptionTime < 10000);
}

function updateConsumptionUI(daily, weekly) {
    consumptionDailyEl.textContent = daily.toFixed(2);
    consumptionWeeklyEl.textContent = weekly.toFixed(2);

    const hoyIndex = 6;
    dailyData[hoyIndex] = parseFloat(daily.toFixed(2));

    const estaSemanaIndex = 3;
    weeklyData[estaSemanaIndex] = parseFloat(weekly.toFixed(2));

    if (consumptionChart) {
        consumptionChart.update('none');
    }
}

function updateGauge(flow) {
    const flowClamped = Math.min(flow, MAX_FLOW);
    const percentage = flowClamped / MAX_FLOW;
    const perimeter = 283;
    const offset = perimeter - (percentage * perimeter);
    
    gaugeFill.style.strokeDashoffset = offset;
}

function addAlertToLog(type, message, severityClass) {
    const tbody = alertsLogTbody;
    
    const noAlerts = tbody.querySelector('.no-alerts-row');
    if (noAlerts) {
        tbody.removeChild(noAlerts);
    }

    const row = document.createElement('tr');
    row.className = 'hover:bg-surface-container-lowest transition-colors';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let severityLabel = 'Crítica';
    let badgeClass = 'bg-status-error/10 text-status-error';
    let dotClass = 'bg-status-error';
    if (severityClass === 'severity-warn') {
        severityLabel = 'Advertencia';
        badgeClass = 'bg-status-warning/10 text-status-warning';
        dotClass = 'bg-status-warning';
    }

    row.innerHTML = `
        <td class="px-3 py-3 text-on-surface-variant font-mono text-xs">${timeStr}</td>
        <td class="px-3 py-3 text-on-surface flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px] ${severityClass === 'severity-warn' ? 'text-status-warning animate-pulse' : 'text-status-error animate-bounce'}">warning</span>
            ${message}
        </td>
        <td class="px-3 py-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">
                <span class="w-1.5 h-1.5 mr-1 rounded-full ${dotClass}"></span>
                ${severityLabel}
            </span>
        </td>
    `;
    
    tbody.insertBefore(row, tbody.firstChild);

    if (tbody.children.length > 15) {
        tbody.removeChild(tbody.lastChild);
    }
}

function initChart() {
    const ctx = document.getElementById('consumptionChart').getContext('2d');
    
    const primaryGradient = ctx.createLinearGradient(0, 0, 0, 200);
    primaryGradient.addColorStop(0, '#004ac6');
    primaryGradient.addColorStop(1, 'rgba(0, 74, 198, 0.05)');

    consumptionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dailyLabels,
            datasets: [{
                label: 'Consumo (Litros)',
                data: dailyData,
                backgroundColor: primaryGradient,
                borderColor: '#004ac6',
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 27, 46, 0.9)',
                    titleFont: { family: 'Outfit', size: 13 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    borderColor: '#c3c6d7',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#434655',
                        font: { family: 'Outfit', size: 11 }
                    }
                },
                y: {
                    grid: {
                        color: '#eaedff'
                    },
                    ticks: {
                        color: '#434655',
                        font: { family: 'Outfit', size: 11 }
                    }
                }
            }
        }
    });
}

function updateChartType(type) {
    if (type === activeChartType) return;
    
    activeChartType = type;
    const ctx = document.getElementById('consumptionChart').getContext('2d');
    
    let label, labels, data, colorStart, colorEnd, borderColor;

    if (type === 'daily') {
        btnChartDaily.classList.add('active', 'text-on-surface');
        btnChartDaily.classList.remove('text-on-surface-variant');
        btnChartWeekly.classList.remove('active', 'text-on-surface');
        btnChartWeekly.classList.add('text-on-surface-variant');
        
        label = 'Consumo Diario (Litros)';
        labels = dailyLabels;
        data = dailyData;
        colorStart = '#004ac6';
        colorEnd = 'rgba(0, 74, 198, 0.05)';
        borderColor = '#004ac6';
    } else {
        btnChartDaily.classList.remove('active', 'text-on-surface');
        btnChartDaily.classList.add('text-on-surface-variant');
        btnChartWeekly.classList.add('active', 'text-on-surface');
        btnChartWeekly.classList.remove('text-on-surface-variant');
        
        label = 'Consumo Semanal (Litros)';
        labels = weeklyLabels;
        data = weeklyData;
        colorStart = '#00687a';
        colorEnd = 'rgba(0, 104, 122, 0.05)';
        borderColor = '#00687a';
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, colorStart);
    gradient.addColorStop(1, colorEnd);

    consumptionChart.data.labels = labels;
    consumptionChart.data.datasets[0].label = label;
    consumptionChart.data.datasets[0].data = data;
    consumptionChart.data.datasets[0].backgroundColor = gradient;
    consumptionChart.data.datasets[0].borderColor = borderColor;
    
    consumptionChart.update();
}

function setupEventListeners() {
    closeAlertBtn.addEventListener('click', () => {
        alertBanner.classList.add('hidden');
    });

    valveSwitch.addEventListener('change', (e) => {
        const command = e.target.checked ? VALVE_OPEN_COMMAND : VALVE_CLOSED_COMMAND;
        console.log('Publicando comando válvula:', command);
        if (client && client.connected) {
            client.publish('casa/agua/valvula', command, { qos: 1 });
        } else {
            console.error('MQTT no conectado. Revirtiendo control.');
            e.target.checked = !e.target.checked;
        }
    });

    // pumpSwitch.addEventListener('change', (e) => {
    //     const command = e.target.checked ? 'ON' : 'OFF';
    //     console.log('Publicando comando bomba:', command);
    //     if (client && client.connected) {
    //         client.publish('casa/agua/bomba', command, { qos: 1 });
    //     } else {
    //         console.error('MQTT no conectado. Revirtiendo control.');
    //         e.target.checked = !e.target.checked;
    //     }
    // });

    btnChartDaily.addEventListener('click', () => updateChartType('daily'));
    btnChartWeekly.addEventListener('click', () => updateChartType('weekly'));
}
