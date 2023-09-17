import zlib from "zlib"
import superjson from "superjson"

// Compress the JSON data
export const compress = (json: Record<string, unknown>[]) => {
	return new Promise<string>((resolve, reject) => {
		zlib.gzip(superjson.stringify(json), (err, buffer) => {
			if (err) reject(err)
			resolve(buffer.toString("base64")) // Convert to base64 string to store in database
		})
	})
}

// Decompress the JSON data
export const decompress = (compressed: string) => {
	return new Promise<Record<string, unknown>[]>((resolve, reject) => {
		const buffer = Buffer.from(compressed, "base64") // Convert base64 string to Buffer
		zlib.gunzip(buffer, (err, decompressed) => {
			if (err) reject(err)
			resolve(superjson.parse(decompressed.toString()))
		})
	})
}
