import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';
import { logger } from '../../common/logging';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'bdd',
		color: true,
		delay: false
	});

	const projectRoot = path.resolve(__dirname, "..", "..");
	// process.env.NODE_PATH = path.resolve(__dirname, "..", "..");
	// require("module").Module._initPaths();

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: projectRoot }, (err, files: string[]) => {
			// remove integration test files
			files = files.filter(f => !f.startsWith('test/'));
            if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(projectRoot, f)));

			try {
				// Run the mocha test
				mocha.run(failures => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				logger.error(err);
				e(err);
			}
		});
	});
}
