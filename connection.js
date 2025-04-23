const neo4j = require('neo4j-driver');

// Connection details
const URI = "neo4j+s://49ac7ea2.databases.neo4j.io"; // Change this if using a remote database
const USER = "neo4j";
const PASSWORD = "servo-subject-cable";

const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

const session = driver.session();

module.exports = { driver, session };
