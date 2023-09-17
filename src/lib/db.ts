import { connect } from "@planetscale/database"
import {
	boolean,
	char,
	int,
	mysqlTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/mysql-core"
import { drizzle } from "drizzle-orm/planetscale-serverless"

export const spreadsheets = mysqlTable("spreadsheets", {
	id: char("id", { length: 36 }).primaryKey(),
	userId: varchar("user_id", { length: 255 }),
	fileName: varchar("file_name", { length: 255 }),
	friendlyName: varchar("friendly_name", { length: 255 }),
	sizeInBytes: int("size_in_bytes"),
	state: varchar("state", { length: 255 }),
	allowDownload: boolean("allow_download"),
	allColumns: text("all_columns"),
	allowedColumns: text("allowed_columns"),
	infoPanelTitle: text("info_panel_title"),
	infoPanelDescription: text("info_panel_description"),
	data: text("data"),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
})

// create the connection
const connection = connect({
	host: process.env.DATABASE_HOST,
	username: process.env.DATABASE_USERNAME,
	password: process.env.DATABASE_PASSWORD,
})

export const db = drizzle(connection)
