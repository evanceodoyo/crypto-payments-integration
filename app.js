const express = require("express");
require("dotenv").config();

const app = express();
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
app.use(express.json())

// Simulated in-memory database
const db = {
    users: {},
    transactions: {}
}

const recordTransaction = (transactionId, data) => {
    db.transactions[transactionId] = data;
    const userId = data.userId;

    if (!db.users[userId]) {
        db.users[userId] = { balance: 0, deposits: [], withdrawals: [] };
    }

    if (data.type === 'deposit') {
        db.users[userId].deposits.push(transactionId);
        db.users[userId].balance += data.amount;
    }

    if (data.type === 'withdrawal') {
        db.users[userId].withdrawals.push(transactionId);
        db.users[userId].balance -= data.amount;
    }
}

const convertKESToUSD = async (amountKES) => {
  try {
    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGERATE_API_KEY}/latest/KES`,
      {
        method: "GET",
      }
    );
    const data = await response.json();
    return amountKES * data.conversion_rates.USD;
  } catch (error) {
    console.log("Error fetching exchange rate:", error.message);
  }
};


// const getCryptoPriceEstimate = async (amount, fiat, crypto) => {
//   try {
//     // Include process fee in the estimation
//     const processFeePercentage = 0.5;
//     const amountWithFee = amount + (amount * processFeePercentage) / 100;

//     const response = await fetch(
//       `https://api.nowpayments.io/v1/estimate?amount=${amountWithFee}&currency_from=${fiat}&currency_to=${crypto}`,
//       {
//         method: "GET",
//         headers: {
//           "x-api-key": NOWPAYMENTS_API_KEY,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     const data = await response.json();

//     if (!data.estimated_amount) {
//       throw new Error("Failed to estimate USDT");
//     }
//     return parseFloat(data.estimated_amount);
//   } catch (error) {
//     console.log("Error estimating crypto:", error.message);
//   }
// };

// getCryptoPriceEstimate(1, "usd", "usdttrc20");


const getMinPaymentAmount = async (
  currencyFrom,
  currencyTo,
  fiatEquivalent = "usd"
) => {
  try {
    const response = await fetch(
      `https://api.nowpayments.io/v1/min-amount?currency_from=${currencyFrom}&currency_to=${currencyTo}&fiat_equivalent=${fiatEquivalent}&is_fixed_rate=False&is_fee_paid_by_user=True`,
      {
        method: "GET",
        headers: {
          "x-api-key": NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    return data.min_amount;
  } catch (error) {
    console.log("Error getting minimum payment amount:", error.message);
  }
};

// getMinPaymentAmount('usdttrc20', 'usdttrc20');

app.post("/deposit", async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Invalid userId or amount" });
  }

  try {
    const crypto = "usdttrc20";
    const fiat = "usd";

    const minAmount = await getMinPaymentAmount(crypto, crypto);
    const amountUSD = await convertKESToUSD(amount);
    console.log("Amount in USD:", amountUSD);
    console.log("Minimum Payment Amount", minAmount);

    // Can be used to avoid unnecessary API call but is less accurate.
    // if (amountUSD < minAmount) {
    //   return res
    //     .status(400)
    //     .json({ error: `Minimum transferable amount is ${minAmount} ${crypto.toUpperCase()}` });
    // }


    const response = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: amountUSD,
        price_currency: fiat,
        pay_currency: crypto,
        ipn_callback_url: process.env.CALLBACK_URL,
        order_id: `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        order_description: `Purchase ${amount} bottles`,
        is_fixed_rate: true,
        is_fee_paid_by_user: true,
      }),
    });

    const data = await response.json();

    if (data.status === false || data.statusCode == 400) {
        return res.status(400).json({ error: `Amount is less than the minimum transferable limit of ${minAmount} ${crypto.toUpperCase()}`})
    }

    if (!data.payment_id || !data.pay_address) {
        throw new Error('Failed to create payment')
    }
    const transactionId = data.payment_id;
    const depositAddress = data.pay_address;
    const payAmount = data.pay_amount;

    // Simulates recording the transaction to db
    recordTransaction(transactionId, {
        userId,
        amount,
        depositAddress,
        type: "deposit",
        usdt: payAmount,
        network: data.network,
        orderId: data.order_id,
        status: data.payment_status,
        estimateAmountRecieved: data.amount_received,
        createAt: data.created_at,
        updatedAt: data.updated_at,
    });

    return res.json({
        transactionId,
        payAmount,
        depositAddress,
        crypto: crypto,
        message: `Send ${payAmount} ${crypto.toUpperCase()} to ${depositAddress}`
    });
  } catch (error) {
    console.error('Deposit error:', error.message);
    return res.status(500).json({error:'Failed to process deposit'});
  }
});


app.post('/callback', async (req, res) => {
    const data = req.body;
  
    console.log('CALLBACK DATA RECEIVED:', data);
  
    return res.status(200).json({success: true});
  });

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
})