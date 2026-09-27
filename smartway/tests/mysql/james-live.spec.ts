import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { databaseConfig } from "../../lib/db-config.mjs";
test("NVIDIA real: authenticated catalog, correction and unique request", async ({
  request,
}) => {
  test.skip(
    process.env.JAMES_LIVE_TEST !== "1",
    "Enable external provider test explicitly.",
  );
  test.setTimeout(180000);
  const pool = mysql.createPool(databaseConfig()),
    code = "JLIVE-" + Date.now().toString(36).toUpperCase();
  let id = 0,
    token = "";
  const headers = { origin: "http://localhost:3101" };
  try {
    const [r] = await pool.execute<mysql.ResultSetHeader>(
      "INSERT INTO parts(code,qr_code,name,location,pack_size) VALUES(?,?,?,?,2)",
      [code, code, "Parafuso teste James real", "Teste"],
    );
    id = r.insertId;
    await pool.execute(
      "INSERT INTO inventory(part_id,warehouse_id,quantity) SELECT ?,id,100 FROM warehouses WHERE is_central=TRUE",
      [id],
    );
    expect(
      (
        await request.post("/api/login", {
          data: { identity: "1001", password: process.env.SEED_PASSWORD },
          headers,
        })
      ).status(),
    ).toBe(200);
    const send = async (data: unknown) => {
      const response = await request.post("/api/james/chat", {
        data,
        headers,
        timeout: 60000,
      });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    let data = await send({
      message: `Adicione 7 caixas do item codigo ${code} e mostre meu carrinho`,
      cart: [],
    });
    expect(data.cart).toHaveLength(1);
    expect(data.cart[0].quantity).toBe(14);
    data = await send({ message: "Troque as caixas para 5", cart: data.cart });
    expect(
      data.cart[0].quantity,
      JSON.stringify({ reply: data.reply, choices: data.choices }),
    ).toBe(10);
    data = await send({ message: "faca a requisicao", cart: data.cart });
    token = data.confirmationToken;
    expect(token).toBeTruthy();
    const body = {
        mode: "confirm",
        token,
        confirmation: "confirmar requisicao",
      },
      first = await send(body),
      again = await send(body);
    expect(first.submitted).toBe(true);
    expect(again.result.ids).toEqual(first.result.ids);
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT quantity FROM inventory WHERE part_id=?",
      [id],
    );
    expect(rows[0].quantity).toBe(100);
  } finally {
    if (token) {
      const key = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString(),
      ).key;
      await pool.execute(
        "DELETE FROM request_submissions WHERE request_key=?",
        [key],
      );
    }
    if (id) {
      await pool.execute(
        "DELETE FROM audit_log WHERE entity_type='request' AND entity_id IN(SELECT id FROM requests WHERE part_id=?)",
        [id],
      );
      await pool.execute("DELETE FROM requests WHERE part_id=?", [id]);
      await pool.execute("DELETE FROM inventory WHERE part_id=?", [id]);
      await pool.execute("DELETE FROM parts WHERE id=?", [id]);
    }
    await pool.end();
  }
});
