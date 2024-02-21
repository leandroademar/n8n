import { Reset } from '@/commands/user-management/reset';
import { InternalHooks } from '@/InternalHooks';
import { LoadNodesAndCredentials } from '@/LoadNodesAndCredentials';
import { NodeTypes } from '@/NodeTypes';
import Container from 'typedi';
import { UserRepository } from '@db/repositories/user.repository';

import { mockInstance } from '../../shared/mocking';
import * as testDb from '../shared/testDb';
import { createMember, createOwner } from '../shared/db/users';
import { SettingsRepository } from '@/databases/repositories/settings.repository';
import { setInstanceOwnerSetUp } from '../shared/utils';
import { createWorkflow } from '../shared/db/workflows';
import { ProjectRepository } from '@/databases/repositories/project.repository';
import { SharedWorkflowRepository } from '@/databases/repositories/sharedWorkflow.repository';
import { createCredential } from '../shared/db/credentials';
import { SharedCredentialsRepository } from '@/databases/repositories/sharedCredentials.repository';
import { continueOnFail } from 'n8n-core';
import { CredentialsRepository } from '@/databases/repositories/credentials.repository';
import { ProjectRelationRepository } from '@/databases/repositories/projectRelation.repository';

let userRepository: UserRepository;
let settingsRepository: SettingsRepository;

beforeAll(async () => {
	mockInstance(InternalHooks);
	mockInstance(LoadNodesAndCredentials);
	mockInstance(NodeTypes);
	await testDb.init();
	userRepository = Container.get(UserRepository);
	settingsRepository = Container.get(SettingsRepository);
});

beforeEach(async () => {
	await testDb.truncate(['User']);
});

afterAll(async () => {
	await testDb.terminate();
});

test('user-management:reset should reset DB to default user state', async () => {
	//
	// ARRANGE
	//
	await createOwner();
	await createMember();
	await setInstanceOwnerSetUp(true);

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	const user = await userRepository.findOneBy({ role: 'global:owner' });
	const numberOfUsers = await userRepository.count();
	const isInstanceOwnerSetUp = await settingsRepository.findOneByOrFail({
		key: 'userManagement.isInstanceOwnerSetUp',
	});

	if (!user) {
		fail('No owner found after DB reset to default user state');
	}

	expect(numberOfUsers).toBe(1);
	expect(isInstanceOwnerSetUp.value).toBe('false');

	expect(user.email).toBeNull();
	expect(user.firstName).toBeNull();
	expect(user.lastName).toBeNull();
	expect(user.password).toBeNull();
	expect(user.personalizationAnswers).toBeNull();
});

test('user-management:reset should reset all workflows', async () => {
	//
	// ARRANGE
	//
	const owner = await createOwner();
	const ownerPersonalProject = await Container.get(
		ProjectRepository,
	).getPersonalProjectForUserOrFail(owner.id);
	const member = await createMember();
	const workflow = await createWorkflow(undefined, member);

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	const [sharedWorkflow] = await Container.get(SharedWorkflowRepository).findByWorkflowIds([
		workflow.id,
	]);
	expect(sharedWorkflow).toBeDefined();
	expect(sharedWorkflow.projectId).toBe(ownerPersonalProject.id);
});

test('user-management:reset should reset all credentials', async () => {
	//
	// ARRANGE
	//
	const owner = await createOwner();
	const ownerPersonalProject = await Container.get(
		ProjectRepository,
	).getPersonalProjectForUserOrFail(owner.id);
	const member = await createMember();
	const credential = await createCredential(
		{
			name: 'foobar',
			data: {},
			type: 'foobar',
			nodesAccess: [],
		},
		{ user: member, role: 'credential:owner' },
	);

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	const sharedCredential = await Container.get(SharedCredentialsRepository).findOneByOrFail({
		credentialsId: credential.id,
	});
	expect(sharedCredential.projectId).toBe(ownerPersonalProject.id);
});

test('user-management:reset should re-own all orphaned credentials', async () => {
	//
	// ARRANGE
	//
	const owner = await createOwner();
	const ownerPersonalProject = await Container.get(
		ProjectRepository,
	).getPersonalProjectForUserOrFail(owner.id);
	const credential = await createCredential(
		{
			name: 'foobar',
			data: {},
			type: 'foobar',
			nodesAccess: [],
		},
		{ user: owner, role: 'credential:owner' },
	);
	await Container.get(SharedCredentialsRepository).delete({ credentialsId: credential.id });

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	const sharedCredentialAfterReset = await Container.get(
		SharedCredentialsRepository,
	).findOneByOrFail({
		credentialsId: credential.id,
	});

	expect(sharedCredentialAfterReset.projectId).toBe(ownerPersonalProject.id);
});

test('user-management:reset should create a personal project if there is none', async () => {
	//
	// ARRANGE
	//
	const owner = await createOwner();
	await Container.get(ProjectRepository).delete({});
	await expect(
		Container.get(ProjectRepository).getPersonalProjectForUser(owner.id),
	).resolves.toBeNull();

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	await expect(
		Container.get(ProjectRepository).getPersonalProjectForUser(owner.id),
	).resolves.not.toBeNull();
});

test('user-management:reset should create an owner if there is none', async () => {
	//
	// ARRANGE
	//
	let owner = await Container.get(UserRepository).findOneBy({ role: 'global:owner' });
	expect(owner).toBeNull();

	//
	// ACT
	//
	await Reset.run();

	//
	// ASSERT
	//
	owner = await Container.get(UserRepository).findOneBy({ role: 'global:owner' });

	if (!owner) {
		fail('Expected owner to be defined.');
	}

	expect(owner.role).toBe('global:owner');
});
