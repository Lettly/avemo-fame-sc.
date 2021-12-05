module.exports = (app, db) => {
    //Add money to wallet with the command /ricarica
    app.command("/ricarica", async ({ command, ack, say }) => {
        // Acknowledge command request
        ack();

        // Get the text in the command
        const text = command.text;

        //get the username of the user
        const username = command.user_name;

        // Get the amount of money to add and convert it to a number
        const amount = parseFloat(text.split(" ")[0]);
        if (typeof amount !== "number" || isNaN(amount)) {
            await say("Inserisci un importo");
            return;
        }

        // Get the wallet ID
        let walletID;
        if (text.split(" ")[1] != "" && text.split(" ")[1] != undefined) {
            walletID = text.split(" ")[1];
        } else {
            walletID = command.user_id;
        }

        // Add the money to the wallet
        await addMoney(walletID, amount);

        // Say something to the channel
        say(`Il conto di ${username} è stato ricaricato con ${amount}€`);
    });

    function addMoney(walletID, amount, username) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT balance FROM wallets WHERE id = ?`,
                walletID,
                (err, row) => {
                    if (err) {
                        reject(err);
                    }
                    const newBalance = (row?.balance ?? 0) + amount;
                    db.run(
                        `INSERT or REPLACE INTO wallets (id, balance, name) VALUES (?, ?, ?)`,
                        walletID,
                        newBalance,
                        username,
                        (err) => {
                            if (err) {
                                reject(err);
                            }
                            db.run(
                                `INSERT INTO transactions (wallet_id, amount, date, description) VALUES (?, ?, ?, ?)`,
                                walletID,
                                amount,
                                new Date().toLocaleString(),
                                "Ricarica",
                                (err) => {
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

    //Show wallet balance and movement with the command /conto
    app.command("/conto", async ({ command, ack, say }) => {
        // Acknowledge command request
        ack();

        // Get the user who sent the command
        const user = command.user_id;

        // Get the text in the command
        const text = command.text;

        //get the username of the user
        const username = command.user_name;

        // Get the wallet ID
        let walletID;
        if (text.split(" ")[0] != "" && text.split(" ")[0] != undefined) {
            walletID = text.split(" ")[0];
        } else {
            walletID = command.user_id;
        }

        // Show the wallet balance
        const balance = await getBalance(walletID, username, say);
        say(`Il conto di ${username} è di ${balance}€`);

        // Show the wallet movement
        await showMovement(walletID, username, say);
    });

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

    function showMovement(walletID, username, say) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT amount, date, description FROM transactions WHERE wallet_id = ?`,
                walletID,
                (err, rows) => {
                    if (err) {
                        reject(err);
                    }
                    let message = `I movimenti di ${username} sono:\n`;
                    rows.forEach((row) => {
                        message += `${row.date} | ${row.amount}€ | ${row.description}\n`;
                    });
                    say(message);
                    resolve();
                }
            );
        });
    }
};
