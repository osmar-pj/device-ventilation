import db from '../database/db.js'

import { DataTypes } from 'sequelize'

const SafetyModel = db.define('safety', {
    serie: { type: DataTypes.STRING },
    mining: { type: DataTypes.STRING },
    level: { type: DataTypes.STRING },
    category: { type: DataTypes.STRING },
    CO: { type: DataTypes.FLOAT },
    NO2: { type: DataTypes.FLOAT },
    CO2: { type: DataTypes.FLOAT },
    O2: { type: DataTypes.FLOAT },
    timestamp: { type: DataTypes.BIGINT }
})

const VentilationModel = db.define('ventilations', {
    serie: { type: DataTypes.STRING },
    mining: { type: DataTypes.STRING },
    level: { type: DataTypes.STRING },
    category: { type: DataTypes.STRING },
    temperatura: { type: DataTypes.FLOAT },
    humedad: { type: DataTypes.FLOAT },
    timestamp: { type: DataTypes.BIGINT }
})

const GasModel = db.define('gases', {
    name: { type: DataTypes.STRING },
    unit: { type: DataTypes.STRING },
    category: { type: DataTypes.STRING },
    serie: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
    min1: { type: DataTypes.FLOAT },
    min2: { type: DataTypes.FLOAT },
    max1: { type: DataTypes.FLOAT },
    max2: { type: DataTypes.FLOAT }
})

db.sync()

export {SafetyModel, VentilationModel, GasModel}