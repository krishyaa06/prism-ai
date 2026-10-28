package com.agent.ai

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * App-private memory storage; callers must gate reads and writes on explicit opt-in.
 */
class PrismMemoryStore(context: Context) :
    SQLiteOpenHelper(context, "prism_memory.db", null, 1) {
    companion object {
        private const val MAX_ENTRIES = 50
        private const val MAX_CONTENT_CHARS = 1000
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE memories (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "content TEXT NOT NULL, " +
                "created_at INTEGER NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun recentContext(limit: Int = 10): String {
        val entries = readableDatabase.rawQuery(
            "SELECT content FROM memories ORDER BY created_at DESC LIMIT ?",
            arrayOf(limit.coerceIn(1, MAX_ENTRIES).toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(cursor.getString(0))
            }
        }
        return entries.asReversed().joinToString("\n")
    }

    @Synchronized
    fun rememberTask(task: String, result: String) {
        val content = "Task: ${task.take(500)}\nOutcome: ${result.take(400)}"
            .take(MAX_CONTENT_CHARS)
        val values = ContentValues().apply {
            put("content", content)
            put("created_at", System.currentTimeMillis())
        }
        writableDatabase.insertOrThrow("memories", null, values)
        writableDatabase.execSQL(
            "DELETE FROM memories WHERE id NOT IN " +
                "(SELECT id FROM memories ORDER BY created_at DESC LIMIT ?)",
            arrayOf(MAX_ENTRIES)
        )
    }

    @Synchronized
    fun clearMemory() {
        writableDatabase.delete("memories", null, null)
    }
}
