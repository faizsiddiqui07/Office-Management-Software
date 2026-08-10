// READ-ONLY: naye upload ke fixes live hue? Writes NOTHING.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import { Setting } from './src/models/Setting.js';
import { User } from './src/models/User.js';
import { PointEntry } from './src/models/PointEntry.js';

await connectDB();
const s = await Setting.findOne({ key: 'global