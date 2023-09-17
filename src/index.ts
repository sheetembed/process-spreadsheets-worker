import { Worker } from "bullmq"
import IORedis from "ioredis"
import { z } from "zod"
import { processSpreadsheet } from "./jobs/process-spreadsheet"

const env = z
	.object({
		PORT: z.coerce.number(),
		REDIS_CONNECTION_STRING: z.string(),
		DATABASE_HOST: z.string(),
		DATABASE_USERNAME: z.string(),
		DATABASE_PASSWORD: z.string(),
	})
	.parse(process.env)

const connection = new IORedis(env.REDIS_CONNECTION_STRING, {
	maxRetriesPerRequest: null,
})

connection.on("error", (error) => {
	console.error(error)
})

connection.on("connect", () => {
	console.log("Connected to Redis")
})

const QUEUES = {
	SPREADSHEET: "spreadsheet",
}

const worker = new Worker(QUEUES.SPREADSHEET, processSpreadsheet, {
	connection,
})

worker.on("completed", (job) => {
	console.log(`${job.id} has completed!`)
})

worker.on("failed", (job, err) => {
	console.log(`${job.id} has failed with ${err.message}`)
})
