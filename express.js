"use strict";
// The functions in this file are responsible for using an express server to serve files for local development.

const express = require("express");

const app = express();
const port = 3000;

app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));
app.use(express.static("."));

app.listen(port, () => console.log(`Covid-cases web app is listening at http://localhost:${port}`));
