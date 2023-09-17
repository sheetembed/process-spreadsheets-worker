import { Processor } from "bullmq"
import { eq } from "drizzle-orm"
import XLSX, { CellObject, Range, WorkBook, WorkSheet } from "xlsx"
import { z } from "zod"
import { compress } from "~/lib/compression"
import { db, spreadsheets } from "~/lib/db"

type CellData = {
	raw_value: string | number | boolean
	row_str_value?: string
	formula: string | null
	data_type: "string" | "number" | "boolean"
	hyperlink: string | null
}

type RowData = Record<string, CellData>

type SheetData = {
	[sheetName: string]: RowData[]
}

type ConvertXLSXToJSONOutput = SheetData[]

const convertXLSXToJSON = (buffer: Buffer): ConvertXLSXToJSONOutput => {
	const workbook: WorkBook = XLSX.read(buffer, { type: "buffer" })

	const result: ConvertXLSXToJSONOutput = []

	workbook.SheetNames.forEach((name: string) => {
		const sheet: WorkSheet = workbook.Sheets[name]
		// rome-ignore lint/style/noNonNullAssertion: <explanation>
		const range: Range = XLSX.utils.decode_range(sheet["!ref"]!) // Assuming !ref exists

		const json: RowData[] = []

		for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum++) {
			const row: RowData = {}

			for (let colNum = range.s.c; colNum <= range.e.c; colNum++) {
				const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: colNum })
				const nextCell: CellObject | undefined = sheet[cellAddress]

				if (typeof nextCell === "undefined") {
					continue
				}

				const hyperlink = sheet[cellAddress]?.l?.Target

				// Assuming header in the first row for column names
				const colName = sheet[XLSX.utils.encode_cell({ r: 0, c: colNum })]?.v
				if (colName && typeof colName === "string") {
					// Populate the cell data
					row[colName] = {
						raw_value:
							nextCell.v instanceof Date
								? nextCell.v.toISOString()
								: nextCell.v,
						row_str_value: nextCell.w,
						formula: nextCell.f || null,
						hyperlink,
						data_type: typeof nextCell.v as "string" | "number" | "boolean",
					}
				}
			}

			json.push(row)
		}

		result.push({ [name]: json })
	})

	return result
}

const SMART_CLEANUP = {
	/**
	 * Rows missing more than this percentage of columns will be removed
	 */
	MIN_COLUMN_VALUE_PERC_THRESHOLD: 0.5,
}

const performSmartCleanup = (data: SheetData[]): SheetData[] => {
	const cleanedData: SheetData[] = []

	for (const sheetData of data) {
		const cleanedSheetData: SheetData = {}

		for (const sheetName in sheetData) {
			if (Object.hasOwnProperty.call(sheetData, sheetName)) {
				const rows = sheetData[sheetName]

				const maxColumns = rows.reduce((acc, row) => {
					const rowLength = Object.keys(row).length
					if (rowLength > acc) {
						return rowLength
					}
					return acc
				}, 0)

				const cleanedRows = rows.filter((row) => {
					const rowLength = Object.keys(row).length
					const percentage = rowLength / maxColumns
					return percentage >= SMART_CLEANUP.MIN_COLUMN_VALUE_PERC_THRESHOLD
				})

				cleanedSheetData[sheetName] = cleanedRows
			}
		}

		cleanedData.push(cleanedSheetData)
	}

	return cleanedData
}

const getJSON = async (buffer: Buffer, smartCleanup: boolean) => {
	const workbook = XLSX.read(buffer, { type: "buffer" })
	const data = convertXLSXToJSON(buffer)

	if (smartCleanup) {
		return performSmartCleanup(data)
	}

	return data
}

const schema = z.object({
	spreadsheetId: z.string(),
	userId: z.string(),
	fileName: z.string(),
	sizeInBytes: z.number(),
	smartCleanup: z.boolean().default(true),
	/**
	 * accept buffer as instance of Buffer
	 * OR accept string and convert to Buffer
	 * OR accept object with type and data properties and convert to Buffer
	 *  - type is the type of the data (e.g. "Buffer")
	 *  - data is the data in base64 format (e.g. [80, 75, ...])
	 */
	buffer: z.union([
		z.instanceof(Buffer),
		z.string().transform((val) => Buffer.from(val, "base64")),
		z.object({
			type: z.literal("Buffer"),
			/**Data can be an array of strings or an array of numbers */
			/**In either case, we should convert to a buffer */
			data: z.array(z.union([z.string(), z.number()])).transform((val) => {
				if (typeof val[0] === "string") {
					return Buffer.from(val.join(""), "base64")
				}
				return Buffer.from(val as number[])
			}),
		}),
	]),
})

export const processSpreadsheet: Processor<
	typeof schema["_input"],
	void, // return value
	"process-spreadsheet"
> = async (job) => {
	const {
		spreadsheetId,
		fileName,
		buffer: reqBuffer,
		smartCleanup,
	} = schema.parse(job.data)

	const buffer =
		reqBuffer instanceof Buffer ? reqBuffer : Buffer.from(reqBuffer.data)

	// Convert the buffer to JSON
	const jsonData = await getJSON(buffer, smartCleanup)

	// Compress the JSON data
	const compressedData = await compress(jsonData)

	// Check if the spreadsheet already exists and is active
	const existingSpreadsheet = await db
		.select()
		.from(spreadsheets)
		.where(eq(spreadsheets.id, spreadsheetId))
		.execute()

	/**
	 * Create a record of spreadsheet tabs -> list of columns
	 */
	const sheetTabNames = jsonData.map((sheet) => {
		return Object.keys(sheet)[0]
	})

	const allColumns = {}
	jsonData.forEach((sheet, sheetIdx) => {
		const sheetName = sheetTabNames[sheetIdx]
		const sheetData = sheet[sheetName]
		const colNames = Object.keys(sheetData[0])
		allColumns[sheetName] = colNames
	})

	if (
		existingSpreadsheet[0].id === spreadsheetId &&
		existingSpreadsheet[0].state !== "processing"
	) {
		// Only update the data column
		await db
			.update(spreadsheets)
			.set({
				data: compressedData,
				allColumns: JSON.stringify(allColumns),
			})
			.where(eq(spreadsheets.id, spreadsheetId))
	} else {
		// Store the compressed data in the database
		await db
			.update(spreadsheets)
			.set({
				data: compressedData,
				state: "active",
				allColumns: JSON.stringify(allColumns),
				allowedColumns: JSON.stringify(allColumns),
			})
			.where(eq(spreadsheets.id, spreadsheetId))
	}
}

export default processSpreadsheet
