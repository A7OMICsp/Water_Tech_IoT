# Sistema IoT de monitorización y control de agua

Prototipo académico basado en ESP32 para monitorizar el caudal de una instalación hidráulica, controlar remotamente una electroválvula y detectar posibles fugas. El sistema comunica el dispositivo físico, Node-RED y un dashboard web mediante MQTT.

## Funcionalidades

- Medición del caudal y de los pulsos generados por un sensor YF-S201.
- Apertura y cierre remoto de una electroválvula de 12 V normalmente cerrada.
- Publicación de telemetría y estados mediante MQTT.
- Cálculo de consumo diario y semanal en Node-RED.
- Dashboard web con caudal, estado de la válvula, consumo y alertas.
- Detección de flujo con la válvula cerrada.
- Cierre automático ante flujo continuo durante un tiempo excesivo.
- Filtrado de pulsos espurios producidos al conmutar el relé.

## Arquitectura

### Circuito hidráulico

```text
Depósito -> Sensor de caudal -> Electroválvula -> Salida
```

### Electrónica

```text
Sensor YF-S201 -> GPIO 27 del ESP32
ESP32 GPIO 25 -> Relé -> Electroválvula de 12 V
```

La electroválvula utiliza una fuente externa de 12 V. El ESP32 únicamente controla el relé y nunca debe recibir directamente esa tensión.

### Software

```text
ESP32 <-> Broker MQTT <-> Node-RED
                  \----> Dashboard web
```

El firmware publica el caudal, el estado y las alertas. Node-RED procesa el consumo acumulado y el dashboard se conecta directamente al broker mediante WebSockets.

## Hardware utilizado

- ESP32 NodeMCU WROOM.
- Sensor de caudal YF-S201.
- Electroválvula de 12 V normalmente cerrada.
- Módulo relé de dos canales y 5 V.
- Fuente de alimentación de 12 V y 2 A.
- Resistencia pull-up de 10 kOhm para la señal del caudalímetro.
- Tubo flexible de 10 mm, racores, adaptadores y cinta de teflón.
- Protoboard y cables Dupont.

## Estructura del proyecto

```text
.
├── sketch_may16a/
│   └── sketch_may16a.ino      # Firmware del ESP32
├── dashboard/
│   ├── index.html             # Interfaz web
│   ├── app.js                 # MQTT y lógica del dashboard
│   ├── styles.css             # Estilos propios
│   └── logo.png
├── node_red_flow.json         # Flujo importable de Node-RED
├── run.sh                     # Arranque del dashboard y Node-RED
├── Memoria.docx               # Memoria del proyecto
└── problemas_chat_iot_agua.md # Bitácora de incidencias técnicas
```

## Dependencias

### Firmware

- Arduino IDE con soporte para ESP32.
- `WiFi.h`.
- `PubSubClient.h`.
- `ArduinoJson.h`.

### Dashboard y backend

- Python 3, utilizado para servir el dashboard.
- Node.js y Node-RED, si se quiere ejecutar el flujo de procesamiento.
- Conexión a Internet para acceder al broker HiveMQ y a las librerías web cargadas desde CDN.

## Configuración del ESP32

Antes de cargar el firmware, revisar en `sketch_may16a/sketch_may16a.ino`:

```cpp
const char* ssid = "NOMBRE_WIFI";
const char* password = "CONTRASEÑA_WIFI";
```

También deben verificarse los pines y la polaridad del montaje:

```cpp
const uint8_t RELAY_VALVE_PIN = 25;
const uint8_t FLOW_PIN = 27;
const uint8_t VALVE_OPEN_PIN_LEVEL = HIGH;
const uint8_t VALVE_CLOSED_PIN_LEVEL = LOW;
```

La calibración actual del sensor está configurada en `450` pulsos por litro:

```cpp
const float PULSES_PER_LITER = 450.0;
```

Este valor debe calibrarse para las condiciones reales de presión y montaje.

> No se deben publicar credenciales WiFi reales en un repositorio público. Para una versión definitiva se recomienda trasladarlas a un archivo `Secrets.h` excluido del control de versiones.

## Convención de la electroválvula

Debido a la polaridad y al cableado del montaje actual, los comandos MQTT de la válvula son:

| Estado físico | Comando MQTT |
|---|---|
| Abierta | `OFF` |
| Cerrada | `ON` |

Esta convención está definida tanto en el firmware como en `dashboard/app.js`. Si se modifica, ambos lados deben mantenerse sincronizados.

## Topics MQTT

El proyecto usa actualmente el broker público `broker.hivemq.com`.

| Topic | Dirección | Contenido |
|---|---|---|
| `casa/agua/caudal` | ESP32 -> sistema | JSON con `flow_l_min`, `pulses` y `timestamp` |
| `casa/agua/estado` | ESP32 -> sistema | JSON con el estado de `valvula` |
| `casa/agua/alerta` | ESP32 -> sistema | Tipo de alerta como texto |
| `casa/agua/valvula` | Sistema -> ESP32 | Comando `OFF` para abrir o `ON` para cerrar |
| `casa/agua/consumo_procesado` | Node-RED -> dashboard | Consumo diario y semanal procesado |

Los topics son genéricos y el broker es público. Para evitar mensajes ajenos o colisiones se recomienda utilizar un prefijo exclusivo, por ejemplo `upv/proyecto2/agua/...`, o desplegar un broker privado con autenticación y TLS.

## Puesta en marcha

### 1. Cargar el firmware

1. Abrir `sketch_may16a/sketch_may16a.ino` en Arduino IDE.
2. Configurar la red WiFi.
3. Instalar las librerías necesarias.
4. Seleccionar la placa y el puerto correspondientes al ESP32.
5. Compilar y cargar el sketch.

### 2. Arrancar el dashboard y Node-RED

Desde la raíz del proyecto:

```bash
chmod +x run.sh
./run.sh
```

Servicios predeterminados:

- Dashboard: <http://localhost:8000>
- Node-RED: <http://localhost:1880>

Se pueden cambiar los puertos:

```bash
DASHBOARD_PORT=8001 NODE_RED_PORT=1881 ./run.sh
```

El script no carga el firmware ni inicia un broker local. El ESP32 debe programarse desde Arduino IDE y el sistema utiliza HiveMQ por Internet.

Para detener los procesos iniciados por el script, pulsar `Ctrl+C`.

## Detección de fugas

El firmware contempla dos situaciones:

1. **Flujo con válvula cerrada:** se publica `Fuga_detectada_valvula_cerrada` cuando el caudal supera `0.1 L/min` mientras el estado lógico de la válvula es cerrado.
2. **Flujo continuo:** se publica `Fuga_Tiempo_Excesivo` si el caudal se mantiene por encima de `0.1 L/min` durante 60 segundos. Después se ordena el cierre automático de la válvula.

Para evitar falsos consumos durante la conmutación, se descartan pulsos durante 1500 ms después de abrir o cerrar la válvula y se aplica un intervalo mínimo de 1000 microsegundos entre pulsos válidos.

## Limitaciones conocidas

- El dashboard conoce el estado lógico publicado por el ESP32, pero no existe un sensor que confirme físicamente la posición de la electroválvula.
- La precisión del caudalímetro depende de la calibración y de las condiciones de presión.
- El broker MQTT actual es público, no utiliza autenticación y emplea topics genéricos.
- La reconexión MQTT del firmware es bloqueante mientras el broker no está disponible.
- La alerta de flujo con válvula cerrada puede publicarse repetidamente mientras persista la condición.
- Las gráficas históricas del dashboard contienen datos de demostración y no constituyen almacenamiento persistente.
- La bomba de presión y el control Bluetooth no forman parte de la versión final.

## Documentación adicional

- `Memoria.docx`: memoria técnica completa.
- `ESPECIFICACION_ENTREGA.md`: requisitos de los entregables.
- `problemas_chat_iot_agua.md`: incidencias encontradas durante las pruebas.
- `problema_bluetooth_esp32.md`: diagnóstico de los problemas con Bluetooth.
- `implementation_plan_iot_agua.md`: planificación inicial de la implementación.

## Autores

Alejandro Moscardó Vilar y Miguel Pérez Pomares.

Proyecto desarrollado para la asignatura **Internet de las Cosas** de la Universitat Politècnica de València.
