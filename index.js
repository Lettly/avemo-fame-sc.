const { App, WorkflowStep } = require("@slack/bolt");
require("dotenv").config();
const fs = require("fs");
var sqlite3 = require("sqlite3").verbose();
var db = new sqlite3.Database("database.sqlite");

db.serialize(function () {
    db.run(`CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    name TEXT,
    balance INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER,
    amount FLOAT,
    description TEXT,
    date TEXT,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER,
    orderName TEXT,
    date TEXT,
    price FLOAT,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id))`);
});

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
});

(async () => {
    require("./wallets")(app, db);
    // Start the app
    await app.start();

    console.log("⚡️ Bolt app is running!");
})();

//Send the database file for download
app.command("/download_database", async ({ command, ack, say }) => {
	// Acknowledge command request
	ack();

	// Send the database file
	await app.client.files.upload({
		channels: command.channel_id,
		filename: `database.sqlite`,
		file: fs.createReadStream("./database.sqlite"),
		filetype: "sqlite",
		initial_comment: "Downloaded database",
		title: "database.sqlite",
	});
});

//Place an order with the given name and the price with the commend /ordina <name> <price>
app.command("/ordina", async ({ command, ack, say }) => {
    // Acknowledge command request
    ack();

    // Get the order name and price
    const { text, user_id, user_name } = command;
	let price = text.split(" ")[text.split(" ").length - 1];
    let orderName = text.split(" ").slice(0, text.split(" ").length - 1).join(" ");

    // Check if the order name is valid
    if (!orderName) {
        say("Please enter a valid order name");
        return;
    }
    orderName = orderName.toLowerCase();

    // Check if the price is valid
    if (!price) {
        say("Please enter a valid price");
        return;
    }

    // Check if the price is a number
    if (isNaN(price)) {
        say("Please enter a valid price");
        return;
    }

    // Check if a similar order name already exists
    // say(JSON.stringify(getSimilarOrder(orderName, price)));

    // Get the current balance of the user
    const balance = await getBalance(user_id);

    // Check if the user has enough money to place the order
    if (balance < price) {
        say(
            `${user_name} IL TUO SALDO È ${
                balance - price
            }€, RICORDI DI PAGARE APPENA POSSIBLE`
        );
    }

    // Create the order
    await placeOrder(user_id, orderName, price);
    say(`${user_name} ha ordinato ${orderName} a ${price}€`);
});

function placeOrder(user_id, orderName, price) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO orders (wallet_id, orderName, price) VALUES (?, ?, ?)`,
            [user_id, orderName, price],
            function (err) {
                if (err) {
                    reject(err);
                }
                //update the balance of the user
                db.run(
                    `UPDATE wallets SET balance = balance - ? WHERE id = ?`,
                    [price, user_id],
                    function (err) {
                        if (err) {
                            reject(err);
                        }
                        //Add the transaction to the database
                        db.run(
                            `INSERT INTO transactions (wallet_id, amount, description, date) VALUES (?, ?, ?, ?)`,
                            [
                                user_id,
                                -price,
                                orderName,
                                new Date().toLocaleString(),
                            ],
                            function (err) {
                                if (err) {
                                    reject(err);
                                }
                                resolve();
                            }
                        );
                    }
                );
            }
        );
    });
}

function getBalance(walletID) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT balance FROM wallets WHERE id = ?`,
            walletID,
            (err, row) => {
                if (err) {
                    reject(err);
                }
                const balance = row?.balance ?? 0;
                resolve(balance);
            }
        );
    });
}

//Get the orders of a user
app.command("/ordini", async ({ command, ack, say }) => {
    // Acknowledge command request
    ack();

    // Get the user id
    let { user_id, user_name, text } = command;
    if (text.split(" ")[0] != "" && text.split(" ")[0] != undefined) {
        user_id = text.split(" ")[0];
        user_name = text.split(" ")[0];
    }

    // Get the orders of the user
    const orders = await getOrders(user_id);

    // Check if the user has any orders
    if (orders.length === 0) {
        say(`${user_name} non ha ordinato nulla`);
        return;
    }

    let message = `${user_name} ha ordinato:\n`;
    orders.forEach((order) => {
        message += `${order.orderName} a ${order.price}€\n`;
    });
    say(message);
});

function getOrders(user_id) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT orderName, price FROM orders WHERE wallet_id = ?`,
            user_id,
            (err, rows) => {
                if (err) {
                    reject(err);
                }
                resolve(rows);
            }
        );
    });
}

//Get all the orders from all the users
app.command("/ordini_tutti", async ({ command, ack, say }) => {
    // Acknowledge command request
    ack();

    // Get the orders of all the users
    let orders = await getOrdersAll();

    // Check if there are any orders
    if (orders.length === 0) {
        say("Non ci sono ordini");
        return;
    }

    let message = `Ordini(${orders.length}):\n`;
    let total = 0;
    //sort the orders by orderName
    orders = orders.sort((a, b) => {
        return a.orderName.localeCompare(b.orderName);
    });
    for (let i = 0; i < orders.length; i++) {
        //check if the orderName is the same as the next orderName and the price is the same as the next price
        if (
            orders.length > i + 1 &&
            orders[i].orderName === orders[i + 1].orderName &&
            orders[i].price === orders[i + 1].price
        ) {
            orders[i + 1].quantity = (orders[i].quantity ?? 1) + 1;
        } else {
            message += `x${orders[i]?.quantity ?? 1} | ${
                orders[i].orderName
            } - ${orders[i].price}€\n`;
        }
        total += orders[i].price;
    }
    message += `\nTotale: ${total}€`;
    say(message);
});

//Get how match money are inside the sherd wallet
app.command("/saldo_cassetta", async ({ command, ack, say }) => {
	// Acknowledge command request
	ack();

	const totalBalance = await getTotalBalance();
	say(`Saldo cassetta: ${totalBalance ?? 0}€`);
});

function getTotalBalance() {
	return new Promise((resolve, reject) => {
		db.all(
			`SELECT SUM(balance) AS totalBalance FROM wallets WHERE balance > 0`,
			(err, rows) => {
				if (err) {
					reject(err);
				}
				resolve(rows[0].totalBalance);
			}
		);
	});
}

function getOrdersAll() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT orderName, price FROM orders`, (err, rows) => {
            if (err) {
                reject(err);
            }
            resolve(rows);
        });
    });
}

// //Show all the orders
const ws_all_orders = new WorkflowStep("all_orders", {
    edit: async ({ ack, step, configure }) => {
        await ack();

        const blocks = [
            {
                type: "input",
                block_id: "channel_id_input",
                element: {
                    type: "plain_text_input",
                    action_id: "name",
                    placeholder: {
                        type: "plain_text",
                        text: "#canale-1",
                    },
                },
                label: {
                    type: "plain_text",
                    text: "Canale sul quale mandare il messaggio",
                },
            },
        ];

        await configure({ blocks });
    },
    save: async ({ ack, step, view, update }) => {
        await ack();

        const { values } = view.state;
        const channelId = values.channel_id_input.name;

        const inputs = {
            channelId: { value: channelId.value },
        };

        const outputs = [
            {
                type: "text",
                name: "channelId",
                label: "Channel id",
            },
        ];

        await update({ inputs, outputs });
    },
    execute: async ({ step, complete, fail }) => {
        const { inputs } = step;

		const outputs = {
            channelId: inputs.channelId.value.split("#")[1].split("|")[0],
        };

        // Get the orders of all the users
        let orders = await getOrdersAll();

        // Check if there are any orders
        if (orders.length === 0) {
            app.client.chat.postMessage({
				channel: outputs.channelId,
				text: "Non ci sono ordini",
			});
            return;
        }

        let message = `Ordini(${orders.length}):\n`;
        let total = 0;
        //sort the orders by orderName
        orders = orders.sort((a, b) => {
            return a.orderName.localeCompare(b.orderName);
        });
        for (let i = 0; i < orders.length; i++) {
            //check if the orderName is the same as the next orderName and the price is the same as the next price
            if (
                orders.length > i + 1 &&
                orders[i].orderName === orders[i + 1].orderName &&
                orders[i].price === orders[i + 1].price
            ) {
                orders[i + 1].quantity = (orders[i].quantity ?? 1) + 1;
            } else {
                message += `x${orders[i]?.quantity ?? 1} | ${
                    orders[i].orderName
                } - ${orders[i].price}€\n`;
            }
            total += orders[i].price;
        }
        message += `\nTotale: ${total}€`;

		//send the message to the channel
		app.client.chat.postMessage({
			channel: outputs.channelId,
			text: message,
		});

        // signal back to Slack that everything was successful
        await complete({ outputs });
    },
});

//Reset all the orders on a workflow step
const ws_reset_orders = new WorkflowStep("reset_orders", {
    edit: async ({ ack, step, configure }) => {
        await ack();

        const blocks = [
            {
                type: "input",
                block_id: "task_name_input",
                element: {
                    type: "plain_text_input",
                    action_id: "name",
                    placeholder: {
                        type: "plain_text",
                        text: "Add a task name",
                    },
                },
                label: {
                    type: "plain_text",
                    text: "Task name",
                },
            },
        ];

        await configure({ blocks });
    },
    save: async ({ ack, step, view, update }) => {
        await ack();

        const { values } = view.state;
        const taskName = values.task_name_input.name;

        const inputs = {
            taskName: { value: taskName.value },
        };

        const outputs = [
            {
                type: "text",
                name: "taskName",
                label: "Task name",
            },
        ];

        await update({ inputs, outputs });
    },
    execute: async ({ step, complete, fail }) => {
        const { inputs } = step;

        //Reset the all the orders
        await resetOrders();

        const outputs = {
            taskName: inputs.taskName.value,
        };

        // signal back to Slack that everything was successful
        await complete({ outputs });
    },
});

function resetOrders() {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM orders`, (err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
}

app.step(ws_reset_orders);
app.step(ws_all_orders);