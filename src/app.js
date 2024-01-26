import http from 'http'
import express from 'express'
import morgan from 'morgan'
import bodyParser from 'body-parser'
import axios from 'axios'

import './database/db.js'
import { GasModel, SafetyModel, VentilationModel } from './models/DataModel.js'

import cors from 'cors'

import { config } from 'dotenv'
config()

import { generateGases } from './libs/generateGases.js'
generateGases()

import { Server } from 'socket.io'

import { Pool } from 'pg'

import safetyRoutes from './routes/safety.routes.js'
import gasRoutes from './routes/gas.routes.js'

const app = express()
const httpServer = http.createServer(app)

const corsOptions = {
    origin: '*',
}

const io = new Server(httpServer);

let USERS = {}
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`)
    USERS[socket.id] = socket
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`)
        delete USERS[socket.id]
    });
});

app.use(bodyParser.json({ limit: '2gb', extended: true }))
app.use(morgan('dev'))
app.use(cors(corsOptions))
app.use(express.json())

const routes = [
    safetyRoutes,
    gasRoutes
]

import modbusRTU from 'modbus-serial'
import mqtt from 'mqtt'
import { Gpio } from 'onoff'

const alert = new Gpio(27, 'out')
const red = new Gpio(22, 'out')
const blue = new Gpio(23, 'out')
const green = new Gpio(24, 'out')

const wapsi_system = new Gpio(25, 'in')

const ledGreen = () => {
    alert.writeSync(1)
    red.writeSync(1)
    blue.writeSync(1)
    green.writeSync(0)
}

const ledYellow = () => {
    alert.writeSync(1)
    red.writeSync(0)
    blue.writeSync(1)
    green.writeSync(0)
}

const ledRed = () => {
    alert.writeSync(0)
    red.writeSync(0)
    blue.writeSync(1)
    green.writeSync(1)
}

const options = {
    clientId: `${process.env.DEVICE_NAME} - ${Math.random().toString(16).substr(2, 8)}`,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
}

const modbus = new modbusRTU()
modbus.connectRTUBuffered(process.env.COM_PORT, { baudRate: 9600 }, () => {
    console.log('Connected to IOT')
})

const client = mqtt.connect(process.env.MQTT_URL, options)
client.on('connect', () => {
    console.log('Connected to MQTT')
    client.subscribe(`${process.env.SERIE}`)
})

// const fan = (v1, v2, v3, v4) => {
//     modbus.setID(10)
//     modbus.writeCoils(0, [v1, v2, v3, v4])
// }

// setInterval( async() => {
//     modbus.setID(10)
//     const result = await modbus.readCoils(0, 6)
//     const data = result.data
//     fan(1, 0, 0, 1)
//     console.log(data)
// }, 1000)

class Device {
    constructor (name, value, und, status, msg, type, serie, min1, min2, max1, max2) {
        this.name = name
        this.value = value
        this.und = und
        this.status = status
        this.msg = msg
        this.type = type
        this.serie = serie
        this.min1 = min1
        this.min2 = min2
        this.max1 = max1
        this.max2 = max2
    }
}

class Controller {
    constructor (serie, mining, level , category, devices, timestamp) {
        this.serie = serie
        this.mining = mining
        this.level = level
        this.category = category
        this.devices = devices
        this.timestamp = timestamp
    }
}

class Notification {
    constructor (description, serie, value, name, msg, timestamp) {
        this.description = description
        this.serie = serie
        this.value = value
        this.name = name
        this.msg = msg
        this.timestamp = timestamp
    }
}

// SAFETY AND VENTILATION

const gases = async() => {
    const gases = await GasModel.findAll({
        order: [
            ['id', 'ASC']
        ]
    })
    return gases
}

gases()

const nms = ['CO', 'NO2', 'CO2', 'O2', 'Temperatura', 'Humedad']
const unds = ['ppm', 'ppm', '%vol', '%vol', '°C', '%RH']
const series = ['S0001', 'S0002', 'S0003', 'S0004', 'S0005', 'S0006']
const mins1 = [-1, -1, -1, 15, -20, 0]
const mins2 = [-1, -1, -1, 19.5, -15, 20]
const maxs1 = [25, 3, 2.5, 23.5, 40, 120]
const maxs2 = [50, 5, 3, 25, 45, 150]

let statusNotification = false

// Funcion para leer distintos sensores
async function readModbusData(id, reg, len) {
    modbus.setID(id)
    try {
        const result = await modbus.readHoldingRegisters(reg, len)
        const data = result.data
        return data
    } catch (error) {
        console.log('ERROR - HORROR')
        return null;
    }
}

// REAL TIME - SAFETY AND VENTILATION AND ACTIVE VENTILATION SYSTEMS

setInterval( async() => {

    let devices1 = []
    let devices2 = []

    const data = await readModbusData(2, 1280, 30)

    if (data) {
        for (let i = 0; i < 4; i++) {
            const value = data[i * 5 + 1] / 10 ** data[i * 5 + 2]

            let AlarmStatus
            let MsgStatus
            if (mins1[i] < value && value <= mins2[i]) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL BAJO'
            } else if (mins2[i] < value && value < maxs1[i]) {
                AlarmStatus = 'Green'
                MsgStatus = 'OK'
            } else if (maxs1[i] <= value && value < maxs2[i]) {
                AlarmStatus = 'Yellow'
                MsgStatus = 'ALERTA NIVEL ALTO'
            } else if (maxs2[i] <= value) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL MUY ALTO'
            }

            const device1 = new Device(nms[i], value, unds[i], AlarmStatus, MsgStatus, 'sa', series[i], mins1[i], mins2[i], maxs1[i], maxs2[i])
            devices1 = [...devices1, device1]

            // SAVE SERVER SAFETY
            const controller = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, device1, new Date().getTime())
            client.publish(process.env.SAVE, JSON.stringify(controller))
        }

        for (let i = 4; i < 6; i++) {
            const value = data[i * 5 + 1] / 10 ** data[i * 5 + 2]

            let AlarmStatus
            let MsgStatus
            if (mins1[i] < value && value <= mins2[i]) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL BAJO'
            } else if (mins2[i] < value && value < maxs1[i]) {
                AlarmStatus = 'Green'
                MsgStatus = 'OK'
            } else if (maxs1[i] <= value && value < maxs2[i]) {
                AlarmStatus = 'Yellow'
                MsgStatus = 'ALERTA NIVEL ALTO'
            } else if (maxs2[i] <= value) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL MUY ALTO'
            }

            const device2 = new Device(nms[i], value, unds[i], AlarmStatus, MsgStatus, 'sa', series[i], mins1[i], mins2[i], maxs1[i], maxs2[i])
            devices2 = [...devices2, device2]

            // SAVE SERVER VENTILATION
            const controller = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, device2, new Date().getTime())
            client.publish(process.env.SAVE, JSON.stringify(controller))
        }
    }

    const controller1 = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, devices1, new Date().getTime())
    const controller2 = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_VE, devices2, new Date().getTime())

}, 2212)

// SAVE DATA - SAFETY AND VENTILATION AND ACTIVE VENTILATION SYSTEMS

setInterval( async() => {

    let devices1 = []
    let devices2 = []

    const data = await readModbusData(2, 1280, 30)

    if (data) {
        for (let i = 0; i < 4; i++) {
            const value = data[i * 5 + 1] / 10 ** data[i * 5 + 2]

            let AlarmStatus
            let MsgStatus
            if (mins1[i] < value && value <= mins2[i]) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL BAJO'
            } else if (mins2[i] < value && value < maxs1[i]) {
                AlarmStatus = 'Green'
                MsgStatus = 'OK'
            } else if (maxs1[i] <= value && value < maxs2[i]) {
                AlarmStatus = 'Yellow'
                MsgStatus = 'ALERTA NIVEL ALTO'
            } else if (maxs2[i] <= value) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL MUY ALTO'
            }

            const device1 = new Device(nms[i], value, unds[i], AlarmStatus, MsgStatus, 'sa', series[i], mins1[i], mins2[i], maxs1[i], maxs2[i])
            devices1 = [...devices1, device1]

            // SAVE SERVER SAFETY
            const controller = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, device1, new Date().getTime())
            client.publish(process.env.SAVE, JSON.stringify(controller))
        }

        for (let i = 4; i < 6; i++) {
            const value = data[i * 5 + 1] / 10 ** data[i * 5 + 2]

            let AlarmStatus
            let MsgStatus
            if (mins1[i] < value && value <= mins2[i]) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL BAJO'
            } else if (mins2[i] < value && value < maxs1[i]) {
                AlarmStatus = 'Green'
                MsgStatus = 'OK'
            } else if (maxs1[i] <= value && value < maxs2[i]) {
                AlarmStatus = 'Yellow'
                MsgStatus = 'ALERTA NIVEL ALTO'
            } else if (maxs2[i] <= value) {
                AlarmStatus = 'Red'
                MsgStatus = 'ALERTA NIVEL MUY ALTO'
            }

            const device2 = new Device(nms[i], value, unds[i], AlarmStatus, MsgStatus, 'sa', series[i], mins1[i], mins2[i], maxs1[i], maxs2[i])
            devices2 = [...devices2, device2]

            // SAVE SERVER VENTILATION
            const controller = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, device2, new Date().getTime())
            client.publish(process.env.SAVE, JSON.stringify(controller))
        }
    }

    // SAVE LOCAL
    const controller1 = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_SA, devices1, new Date().getTime())
    const controller2 = new Controller(process.env.SERIE, process.env.DEVICE_NAME, process.env.LEVEL, process.env.CATEGORY_VE, devices2, new Date().getTime())

    await SafetyModel.create({
        serie: process.env.SERIE,
        mining: process.env.DEVICE_NAME,
        level: process.env.LEVEL,
        category: process.env.CATEGORY_SA,
        CO: controller1.devices[0].value,
        NO2: controller1.devices[1].value,
        CO2: controller1.devices[2].value,
        O2: controller1.devices[3].value,
        timestamp: controller1.timestamp
    })

    await VentilationModel.create({
        serie: process.env.SERIE,
        mining: process.env.DEVICE_NAME,
        level: process.env.LEVEL,
        category: process.env.CATEGORY_VE,
        temperatura: controller2.devices[0].value,
        humedad: controller2.devices[1].value,
        timestamp: controller2.timestamp
    })

}, 60005)

// setInterval( async() => {
//     const serie = 'WAPSI-610'
//     const mining = 'Julcani'
//     const level = 'BP-273'
//     const category = 'safety'
//     const devices = {
//         serie: serie,
//         mining: mining,
//         level: level,
//         category: category,
//         device: {
//             name: 'CO',
//             value: 21,
//             msg: 'GREEN'
//         }
//     }

//     await DataModel.create({
//         serie: serie,
//         mining: mining,
//         level: level,
//         category: category,
//         devices: devices,
//         CO: devices.device.value,
//         timestamp: new Date().getTime()
//     })

//     // const data = await DataModel.create({
//     //     name: nombre,
//     //     lastname: apellido,
//     // })

//     // console.log(data);

// }, 5000)

app.use('/', routes)

app.get('/', (req, res) => {
    res.send({ message: 'Welcome to the RASPBERRY' });
});

httpServer.listen(process.env.PORT, () => {
    console.log('Server up and running');
});