import { registerDemoCommands } from "./demoCommands.js";
import { startKafka } from "./kafka.js";
import { startSmartCardReader } from "./smartCardReader.js";

await startKafka();
await startSmartCardReader();
registerDemoCommands();
