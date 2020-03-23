import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Publisher, Subscriber, Session, SignalOptions, Stream, StreamEvent, StreamManagerEvent } from 'openvidu-browser';
import { DialogErrorComponent } from '../shared/components/dialog-error/dialog-error.component';
import { OpenViduLayout, OpenViduLayoutOptions } from '../shared/layout/openvidu-layout';
import { UserModel } from '../shared/models/user-model';
import { NetworkService } from '../shared/services/network/network.service';
import { ChatComponent } from '../shared/components/chat/chat.component';
import { OvSettings } from '../shared/models/ov-settings';
import { UtilsService } from '../shared/services/utils/utils.service';
import { OpenViduSessionService } from '../shared/services/openvidu-session/openvidu-session.service';
import { Subscription } from 'rxjs';
import { ScreenType, VideoType } from '../shared/types/video-type';

@Component({
	selector: 'app-video-room',
	templateUrl: './video-room.component.html',
	styleUrls: ['./video-room.component.css']
})
export class VideoRoomComponent implements OnInit, OnDestroy {
	// webComponent's inputs and outputs
	@Input() ovSettings: OvSettings;
	@Input() sessionName: string;
	@Input() user: string;
	@Input() openviduServerUrl: string;
	@Input() openviduSecret: string;
	@Input() tokens: string[];
	@Input() theme: string;
	@Input() isWebComponent: boolean;
	@Output() joinSession = new EventEmitter<any>();
	@Output() leaveSession = new EventEmitter<any>();
	@Output() error = new EventEmitter<any>();

	@ViewChild('chatComponent') chatComponent: ChatComponent;
	@ViewChild('sidenav') chat: any;

	// Constants
	readonly BIG_ELEMENT_CLASS = 'OV_big';

	// Variables
	compact = false;
	sidenavMode: 'side' | 'over' = 'side';
	lightTheme: boolean;
	chatOpened: boolean;
	showDialogExtension = false;
	showDialogChooseRoom = true;
	session: Session;
	sessionScreen: Session;
	openviduLayout: OpenViduLayout;
	openviduLayoutOptions: OpenViduLayoutOptions;
	mySessionId: string;
	myUserName: string;
	localUsers: UserModel[] = [];
	remoteUsers: UserModel[] = [];
	messageList: { connectionId: string; nickname: string; message: string; userAvatar: string }[] = [];
	newMessages = 0;

	private oVUsersSubscription: Subscription;

	constructor(
		private networkSrv: NetworkService,
		private router: Router,
		public dialog: MatDialog,
		private utilsSrv: UtilsService,
		private oVSessionService: OpenViduSessionService
	) {}

	@HostListener('window:beforeunload')
	beforeunloadHandler() {
		this.exitSession();
	}

	@HostListener('window:resize')
	sizeChange() {
		if (this.openviduLayout) {
			this.openviduLayout.updateLayout();
			this.checkSizeComponent();
		}
	}

	async ngOnInit() {
		this.lightTheme = this.theme === 'light';
		this.ovSettings = this.ovSettings ? this.ovSettings : await this.networkSrv.getOvSettingsData();
	}

	ngOnDestroy() {
		this.exitSession();
	}
	onConfigRoomJoin() {
		this.showDialogChooseRoom = false;
		this.oVUsersSubscription = this.oVSessionService.OVUsers.subscribe(users => {
			this.localUsers = users;
		});
		this.mySessionId = this.oVSessionService.getSessionId();

		setTimeout(() => {
			this.openviduLayout = new OpenViduLayout();
			this.openviduLayoutOptions = this.utilsSrv.getOpenviduLayoutOptions();
			this.openviduLayout.initLayoutContainer(document.getElementById('layout'), this.openviduLayoutOptions);
			this.checkSizeComponent();
			this.joinToSession();
		}, 50);
	}

	joinToSession() {
		this.oVSessionService.initSession();
		this.session = this.oVSessionService.getWebcamSession();
		this.sessionScreen = this.oVSessionService.getScreenSession();
		// !! Refactor these methods
		// this.subscribeToUserChanged();
		this.subscribeToStreamCreated();
		this.subscribedToStreamDestroyed();
		// this.subscribedToChat();
		this.connectToSession();
	}

	exitSession() {
		this.oVSessionService.disconnect();
		this.oVUsersSubscription.unsubscribe();
		this.session = null;
		this.sessionScreen = null;
		this.localUsers = [];
		this.remoteUsers = [];
		this.openviduLayout = null;
		this.router.navigate(['']);
		this.leaveSession.emit();
	}

	onNicknameUpdate(nickname: string) {
		this.oVSessionService.setWebcamName(nickname);
		// ! this.sendSignalUserChanged(user);
	}

	toggleChat() {
		this.chat.toggle().then(() => {
			this.chatOpened = this.chat.opened;
			if (this.chatOpened) {
				this.newMessages = 0;
			}
			const ms = this.isWebComponent ? 300 : 0;
			setTimeout(() => this.openviduLayout.updateLayout(), ms);
		});
	}

	toggleMic(): void {
		const isVideoActive = !this.oVSessionService.hasWebcamAudioActive();
		this.oVSessionService.publishAudio(isVideoActive);
		// ! this.sendSignalUserChanged(this.localUsers[0]);
	}

	// ? ChatService
	checkNotification() {
		this.newMessages = this.chatOpened ? 0 : this.newMessages + 1;
	}

	async toggleCam() {
		const isVideoActive = !this.oVSessionService.hasWebCamVideoActive();

		if (this.oVSessionService.areBothConnected()) {
			this.oVSessionService.publishVideo(isVideoActive);
			this.oVSessionService.disableWebcamUser();
			this.oVSessionService.unpublishWebcam();
			return;
		}
		if (this.oVSessionService.isOnlyScreenConnected()) {
			this.oVSessionService.enableWebcamUser();
			await this.oVSessionService.publishWebcam();
		}
		this.oVSessionService.publishVideo(isVideoActive);
	}

	toggleScreenShare() {
		if (this.oVSessionService.isScreenShareEnabled()) {
			if (this.oVSessionService.isOnlyScreenConnected()) {
				this.oVSessionService.enableWebcamUser();
				this.oVSessionService.publishWebcam();
			}
			this.oVSessionService.disableScreenUser();
			this.oVSessionService.unpublishScreenSession();
		} else {
			const screenPublisher = this.initScreenPublisher();
			screenPublisher.on('accessAllowed', event => {
				console.log('ACCESS ALOWED screenPublisher');
				this.oVSessionService.enableScreenUser(screenPublisher);
				this.oVSessionService.publishScreen();
			});

			screenPublisher.on('accessDenied', event => {
				console.warn('ScreenShare: Access Denied');
			});
		}
	}

	toggleDialogExtension() {
		this.showDialogExtension = !this.showDialogExtension;
	}

	replaceScreenTrack() {
		this.oVSessionService.replaceScreenTrack();
	}

	checkSizeComponent() {
		this.compact = document.getElementById('room-container').offsetWidth <= 790;
		this.sidenavMode = this.compact ? 'over' : 'side';
	}

	enlargeElement(event) {
		const path = event.path ? event.path : event.composedPath(); // Chrome or Firefox
		const element: HTMLElement = path.filter((e: HTMLElement) => e.className && e.className.includes('OT_root'))[0];
		if (element.className.includes(this.BIG_ELEMENT_CLASS)) {
			element.classList.remove(this.BIG_ELEMENT_CLASS);
		} else {
			element.classList.add(this.BIG_ELEMENT_CLASS);
		}
		this.openviduLayout.updateLayout();
	}

	private deleteRemoteStream(stream: Stream): void {
		const userStream = this.remoteUsers.filter((user: UserModel) => user.getStreamManager().stream === stream)[0];
		const index = this.remoteUsers.indexOf(userStream, 0);
		if (index > -1) {
			this.remoteUsers.splice(index, 1);
		}
	}

	private async connectToSession(): Promise<void> {
		if (this.tokens) {
			// Retrieves tokens from subcomponent or library
			// this.localUsers.forEach((user, index) => {
			// 	if (user.isLocal()) {
			// 		this.connect(this.tokens[index]);
			// 	} else if (user.isScreen()) {
			// 		this.startScreenSharing(index);
			// 	}
			// });
		} else {
			// Normal behaviour - OpenVidu Call

			const webcamToken = await this.getToken();
			const screenToken = await this.getToken();
			await this.connectBothSessions(webcamToken, screenToken);

			if (this.oVSessionService.areBothConnected()) {
				this.oVSessionService.publishWebcam();
				this.oVSessionService.publishScreen();
			} else if (this.oVSessionService.isOnlyScreenConnected()) {
				this.oVSessionService.publishScreen();
			} else {
				this.oVSessionService.publishWebcam();
			}
		}
		this.openviduLayout.updateLayout();
	}

	private async connectBothSessions(webcamToken: string, screenToken: string) {
		try {
			await this.oVSessionService.connectWebcamSession(webcamToken);
			await this.oVSessionService.connectScreenSession(screenToken);

			// this.sendSignalUserChanged(this.localUsers[0]);
			// ! this.joinSession.emit(); Webcomponent

			this.localUsers[0].getStreamManager().on('streamPlaying', () => {
				this.openviduLayout.updateLayout();
				(<HTMLElement>this.localUsers[0].getStreamManager().videos[0].video).parentElement.classList.remove('custom-class');
			});
		} catch (error) {
			this.error.emit({ error: error.error, messgae: error.message, code: error.code, status: error.status });
			console.log('There was an error connecting to the session:', error.code, error.message);
			this.openDialogError('There was an error connecting to the session:', error.message);
		}
	}

	private subscribeToStreamCreated() {
		this.session.on('streamCreated', (event: StreamEvent) => {
			const connectionId = event.stream.connection.connectionId;
			if (!this.oVSessionService.isMyOwnConnection(connectionId)) {
				const subscriber: Subscriber = this.session.subscribe(event.stream, undefined);

				subscriber.on('streamPlaying', (e: StreamManagerEvent) => {
					this.checkSomeoneShareScreen();
				});

				const nickname = JSON.parse(event.stream.connection.data)?.clientData;
				const type = event.stream.typeOfVideo === 'SCREEN' ? VideoType.SCREEN : VideoType.REMOTE;

				const newUser = new UserModel(connectionId, subscriber, null, null, nickname, type);

				this.remoteUsers.push(newUser);

				// !Refactor
				// this.localUsers.forEach(user => {
				// 	this.sendSignalUserChanged(user);
				// });
			}
		});
	}

	private subscribedToStreamDestroyed() {
		this.session.on('streamDestroyed', (event: StreamEvent) => {
			this.deleteRemoteStream(event.stream);
			this.checkSomeoneShareScreen();
			// event.preventDefault();
		});
	}

	private subscribeToUserChanged() {
		this.session.on('signal:userChanged', (event: any) => {
			const data = JSON.parse(event.data);
			this.remoteUsers.forEach((user: UserModel) => {
				if (user.getConnectionId() === event.from.connectionId) {
					if (!!data.isAudioActive) {
						user.setAudioActive(data.isAudioActive);
					}
					if (!!data.isVideoActive) {
						user.setVideoActive(data.isVideoActive);
					}
					if (!!data.nickname) {
						user.setNickname(data.nickname);
					}
					if (!!data.isScreenShareActive) {
						user.setScreenShareActive(data.isScreenShareActive);
					}
					if (!!data.avatar) {
						user.setUserAvatar(data.avatar);
					}
				}
			});
			this.checkSomeoneShareScreen();
		});
	}

	private subscribedToChat() {
		this.session.on('signal:chat', (event: any) => {
			const data = JSON.parse(event.data);
			const messageOwner =
				this.localUsers[0].getConnectionId() === data.connectionId
					? this.localUsers[0]
					: this.remoteUsers.filter(user => user.getConnectionId() === data.connectionId)[0];
			this.messageList.push({
				connectionId: data.connectionId,
				nickname: data.nickname,
				message: data.message,
				userAvatar: messageOwner.getAvatar()
			});
			this.checkNotification();
			this.chatComponent.scrollToBottom();
		});
	}

	private sendSignalUserChanged(user: UserModel): void {
		const session = user.isLocal() ? this.session : this.sessionScreen;
		const data = {
			isAudioActive: user.isAudioActive(),
			isVideoActive: user.isVideoActive(),
			isScreenShareActive: user.isScreenShareActive(),
			nickname: user.getNickname(),
			avatar: user.getAvatar()
		};
		const signalOptions: SignalOptions = {
			data: JSON.stringify(data),
			type: 'userChanged'
		};
		session.signal(signalOptions);
	}

	private openDialogError(message, messageError: string) {
		this.dialog.open(DialogErrorComponent, {
			width: '450px',
			data: { message: message, messageError: messageError }
		});
	}

	private checkSomeoneShareScreen() {
		let isScreenShared: boolean;
		// return true if at least one passes the test
		isScreenShared = this.remoteUsers.some(user => user.isScreenShareActive()) || this.oVSessionService.isScreenShareEnabled();
		this.openviduLayoutOptions.fixedRatio = isScreenShared;
		this.openviduLayout.setLayoutOptions(this.openviduLayoutOptions);
		this.openviduLayout.updateLayout();
	}

	private initScreenPublisher(): Publisher {
		const videoSource = this.getScreenVideoSource();
		const willThereBeWebcam = this.oVSessionService.isWebCamEnabled() && this.oVSessionService.hasWebCamVideoActive();
		const hasAudio = willThereBeWebcam ? false : this.oVSessionService.hasWebcamAudioActive();
		const properties = this.oVSessionService.createProperties(videoSource, undefined, true, hasAudio, false);

		try {
			return this.oVSessionService.initScreenPublisher(undefined, properties);
		} catch (error) {
			console.error(error);
			if (error && error.name === 'SCREEN_EXTENSION_NOT_INSTALLED') {
				this.toggleDialogExtension();
			} else {
				this.utilsSrv.handlerScreenShareError(error);
			}
		}
	}

	private async getToken(): Promise<string> {
		try {
			return await this.networkSrv.getToken(this.mySessionId, this.openviduServerUrl, this.openviduSecret);
		} catch (error) {
			this.error.emit({ error: error.error, messgae: error.message, code: error.code, status: error.status });
			console.log('There was an error getting the token:', error.code, error.message);
			this.openDialogError('There was an error getting the token:', error.message);
		}
	}

	private getScreenVideoSource(): string {
		return this.utilsSrv.isFF() ? ScreenType.WINDOW : ScreenType.SCREEN;
	}
}
