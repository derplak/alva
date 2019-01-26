import * as M from '../message';
import { MessageType as MT } from '../message';
import * as T from '../types';
import * as uuid from 'uuid';
import { performAnalysis } from './perform-analysis';
import { getPackage } from '../analyzer/get-package';

export function updateNpmPatternLibrary({
	host,
	dataHost
}: T.MatcherContext): T.Matcher<M.UpdateNpmPatternLibraryRequest> {
	return async m => {
		const { libId, projectId } = m.payload;
		const app = await host.getApp(m.appId || '');

		if (!app) {
			host.log(`updateNpmPatternLibrary: received message without resolvable app: ${m}`);
			return;
		}

		const project = await dataHost.getProject(projectId);
		if (!project) {
			host.log(`updateNpmPatternLibrary: received message without resolveable project: ${m}`);
			return;
		}

		const previousLibrary = project.getPatternLibraryById(libId);

		if (!previousLibrary) {
			host.log(`updateNpmPatternLibrary: received message without resolveable library: ${m}`);
			return;
		}

		const result = await getPackage(m.payload.npmId || previousLibrary.getPackageName(), {
			cwd: await host.resolveFrom(T.HostBase.AppData, 'packages')
		});

		if (result instanceof Error) {
			return app.send({
				type: MT.ShowError,
				id: uuid.v4(),
				payload: {
					message: 'Sorry, we could not fetch this package.',
					detail: result.message,
					error: {
						message: result.message,
						stack: result.stack || ''
					}
				}
			});
		}

		const analysisResult = await performAnalysis(result.path, { previousLibrary });

		if (analysisResult.type === T.LibraryAnalysisResultType.Error) {
			host.log(analysisResult.error.message);

			app.send({
				type: MT.ShowError,
				id: uuid.v4(),
				payload: {
					message: 'Sorry, this seems to be an incompatible library.',
					detail: 'Learn more about supported component libraries on github.com/meetalva',
					help: 'https://github.com/meetalva/alva#pattern-library-requirements',
					error: {
						message: analysisResult.error.message,
						stack: analysisResult.error.stack || ''
					}
				}
			});
			return;
		}

		const analysis = analysisResult.result;
		const analysisName = analysisResult.result.packageFile
			? (analysisResult.result.packageFile as { name?: string }).name || 'Library'
			: 'Library';
		const analysisVersion = analysisResult.result.packageFile
			? (analysisResult.result.packageFile as { version?: string }).version || '1.0.0'
			: '1.0.0';

		dataHost.addConnection(project, {
			id: `${analysisName}@${analysisVersion}`,
			path: analysis.path
		});

		app.send({
			type: M.MessageType.UpdatePatternLibraryResponse,
			id: m.id,
			transaction: m.transaction,
			payload: {
				result: 'success',
				analysis: analysisResult.result,
				path: result.path,
				previousLibraryId: previousLibrary.getId(),
				installType: T.PatternLibraryInstallType.Remote
			}
		});
	};
}