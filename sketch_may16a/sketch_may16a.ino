#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const uint8_t RELAY_VALVE_PIN = 25;
//const uint8_t RELAY_PUMP_PIN = 26;
const uint8_t FLOW_PIN = 27;
const uint8_t VALVE_OPEN_PIN_LEVEL = HIGH;  // La válvula NC recibe voltaje y se abre.
const uint8_t VALVE_CLOSED_PIN_LEVEL = LOW; // La válvula NC deja de recibir voltaje y se cierra.
const char* VALVE_OPEN_COMMAND = "OFF";
const char* VALVE_CLOSED_COMMAND = "ON";

const char* ssid = "iPhone 14 Pro Max de Anjelandro";
const char* password = "11Alex11";
const char* mqtt_server = "broker.hivemq.com";
const uint16_t mqtt_port = 1883;

WiFiClient espClient;
PubSubClient client(espClient);

volatile unsigned long pulseCount = 0;
volatile unsigned long lastPulseMicros = 0;
unsigned long lastMeasureMillis = 0;
const unsigned long measureInterval = 1000;
const float PULSES_PER_LITER = 450.0;
const unsigned long MIN_PULSE_INTERVAL_US = 1000;
const unsigned long VALVE_SWITCH_IGNORE_MS = 1500;
unsigned long ignoreFlowUntilMillis = 0;

bool valveState = false;
// bool pumpState = false;

bool flowActive = false;
unsigned long flowStartMillis = 0;
const unsigned long LEAK_TIME_THRESHOLD = 60000;

void IRAM_ATTR pulseCounter() {
  unsigned long nowMicros = micros();
  if (nowMicros - lastPulseMicros >= MIN_PULSE_INTERVAL_US) {
    pulseCount++;
    lastPulseMicros = nowMicros;
  }
}

void publishState();
void reconnect();
void setValveState(bool open);

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_VALVE_PIN, OUTPUT);
  // pinMode(RELAY_PUMP_PIN, OUTPUT);
  setValveState(false);
  // digitalWrite(RELAY_PUMP_PIN, LOW);

  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), pulseCounter, RISING);

  WiFi.begin(ssid, password);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(200);
  }

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback([](char* topic, byte* payload, unsigned int length){
    String t = String(topic);
    String message;
    for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

    if (t == "casa/agua/valvula") {
      if (message.equalsIgnoreCase(VALVE_OPEN_COMMAND)) {
        setValveState(true);
      } else if (message.equalsIgnoreCase(VALVE_CLOSED_COMMAND)) {
        setValveState(false);
      }
      publishState();
    }
    // else if (t == "casa/agua/bomba") {
    //   if (message.equalsIgnoreCase("ON")) {
    //     pumpState = true;
    //     digitalWrite(RELAY_PUMP_PIN, HIGH);
    //   } else if (message.equalsIgnoreCase("OFF")) {
    //     pumpState = false;
    //     digitalWrite(RELAY_PUMP_PIN, LOW);
    //   }
    //   publishState();
    // }
  });

  lastMeasureMillis = millis();
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  unsigned long now = millis();
  if (now - lastMeasureMillis >= measureInterval) {
    noInterrupts();
    unsigned long pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    if ((long)(ignoreFlowUntilMillis - now) > 0) {
      pulses = 0;
    }

    float flow_l_min = (pulses * 60.0) / PULSES_PER_LITER;

    StaticJsonDocument<200> doc;
    doc["flow_l_min"] = flow_l_min;
    doc["pulses"] = pulses;
    doc["timestamp"] = now;

    char buf[128];
    size_t n = serializeJson(doc, buf);
    client.publish("casa/agua/caudal", buf, n);

    if ((flow_l_min > 0.1) && !valveState) {
      client.publish("casa/agua/alerta", "Fuga_detectada_valvula_cerrada");
      Serial.println("ALERTA: Fuga detectada (caudal con valvula cerrada)!");
    }

    if (flow_l_min > 0.1) {
      if (!flowActive) {
        flowActive = true;
        flowStartMillis = now;
      } else if (now - flowStartMillis >= LEAK_TIME_THRESHOLD) {
        client.publish("casa/agua/alerta", "Fuga_Tiempo_Excesivo");
        Serial.println("ALERTA: Fuga por flujo continuo prolongado detectada. Auto-cerrando valvula!");
        
        setValveState(false);
        // pumpState = false;
        // digitalWrite(RELAY_PUMP_PIN, LOW);
        
        flowActive = false;
      }
    } else {
      flowActive = false;
    }

    publishState();

    lastMeasureMillis = now;
  }
}

void publishState() {
  StaticJsonDocument<128> s;
  s["valvula"] = valveState ? VALVE_OPEN_COMMAND : VALVE_CLOSED_COMMAND;
  // s["bomba"] = pumpState ? "ON" : "OFF";
  char b[64];
  size_t l = serializeJson(s, b);
  client.publish("casa/agua/estado", b, l);
}

void setValveState(bool open) {
  bool changed = (valveState != open);
  valveState = open;
  digitalWrite(RELAY_VALVE_PIN, open ? VALVE_OPEN_PIN_LEVEL : VALVE_CLOSED_PIN_LEVEL);

  if (changed) {
    noInterrupts();
    pulseCount = 0;
    interrupts();
    ignoreFlowUntilMillis = millis() + VALVE_SWITCH_IGNORE_MS;
    flowActive = false;
  }
}

void reconnect() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.disconnect();
    WiFi.begin(ssid, password);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) delay(200);
  }

  while (!client.connected()) {
    String clientId = "ESP32-Agua-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (client.connect(clientId.c_str())) {
      client.subscribe("casa/agua/valvula");
      // client.subscribe("casa/agua/bomba");
      publishState();
    } else {
      delay(2000);
    }
  }
}
