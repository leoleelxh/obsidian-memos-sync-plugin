import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';

interface MemoItem {
    name: string;
    uid: string;
    content: string;
    visibility: string;
    createTime: string;
    updateTime: string;
    displayTime: string;
    creator: string;
    rowStatus: string;
    pinned: boolean;
    resources: Array<{
        name: string;
        uid: string;
        filename: string;
        type: string;
        size: string;
        createTime: string;
    }>;
    tags: string[];
}

interface MemosResponse {
    memos: MemoItem[];
    nextPageToken?: string;
}

interface MemosPluginSettings {
    memosApiUrl: string;
    memosAccessToken: string;
    syncDirectory: string;
    syncFrequency: 'manual' | 'auto';
    autoSyncInterval: number;
    syncLimit: number;
}

const DEFAULT_SETTINGS: MemosPluginSettings = {
    memosApiUrl: '',
    memosAccessToken: '',
    syncDirectory: 'memos',
    syncFrequency: 'manual',
    autoSyncInterval: 30,
    syncLimit: 1000
}

export default class MemosSyncPlugin extends Plugin {
    settings: MemosPluginSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new MemosSyncSettingTab(this.app, this));

        this.addRibbonIcon('sync', 'Sync Memos', async () => {
            await this.syncMemos();
        });

        if (this.settings.syncFrequency === 'auto') {
            this.initializeAutoSync();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private initializeAutoSync() {
        const interval = this.settings.autoSyncInterval * 60 * 1000;
        setInterval(() => this.syncMemos(), interval);
    }

    private async fetchAllMemos(): Promise<MemoItem[]> {
        try {
            console.log('开始获取 memos，API URL:', this.settings.memosApiUrl);
            console.log('Access Token:', this.settings.memosAccessToken ? '已设置' : '未设置');

            const allMemos: MemoItem[] = [];
            let pageToken: string | undefined;
            const pageSize = 100;

            // 验证 API URL 格式
            if (!this.settings.memosApiUrl.includes('/api/v1')) {
                throw new Error('API URL 格式不正确，请确保包含 /api/v1');
            }

            while (allMemos.length < this.settings.syncLimit) {
                // 使用标准的 REST API 路径
                const baseUrl = this.settings.memosApiUrl;
                const url = `${baseUrl}/memos`;

                // 构建请求参数
                const params = new URLSearchParams({
                    'rowStatus': 'NORMAL',
                    'limit': pageSize.toString()
                });

                if (pageToken) {
                    params.set('offset', pageToken);
                }

                const finalUrl = `${url}?${params.toString()}`;

                console.log('请求 URL:', finalUrl);

                const response = await fetch(finalUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.settings.memosAccessToken}`,
                        'Accept': 'application/json'
                    }
                });

                console.log('响应状态:', response.status);
                // 将响应头转换为对象并输出
                const headers: { [key: string]: string } = {};
                response.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                console.log('响应头:', JSON.stringify(headers, null, 2));

                const responseText = await response.text();
                console.log('原始响应内容:', responseText);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}\n响应内容: ${responseText}`);
                }

                let data: MemosResponse;
                try {
                    data = JSON.parse(responseText);
                    console.log('解析后的响应数据:', JSON.stringify(data, null, 2));
                } catch (e) {
                    throw new Error(`JSON 解析失败: ${e.message}\n响应内容: ${responseText}`);
                }

                if (!data.memos || !Array.isArray(data.memos)) {
                    throw new Error(`响应格式无效: 未找到 memos 数组\n响应内容: ${responseText}`);
                }

                allMemos.push(...data.memos);
                console.log(`本次获取 ${data.memos.length} 条 memos，总计: ${allMemos.length}`);

                if (!data.nextPageToken || allMemos.length >= this.settings.syncLimit) {
                    break;
                }
                pageToken = data.nextPageToken;
            }

            const result = allMemos.slice(0, this.settings.syncLimit);
            console.log(`最终返回 ${result.length} 条 memos`);

            return result.sort((a, b) =>
                new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
            );
        } catch (error) {
            console.error('获取 memos 失败:', error);
            if (error instanceof TypeError && error.message === 'Failed to fetch') {
                throw new Error(`网络错误: 法连接到 ${this.settings.memosApiUrl}。请检查 URL 是否正确且可访问。`);
            }
            throw error;
        }
    }

    private formatDateTime(date: Date, format: 'filename' | 'display' = 'display'): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        if (format === 'filename') {
            return `${year}-${month}-${day} ${hours}-${minutes}`;
        }
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    private sanitizeFileName(fileName: string): string {
        // 移除或替换不安全的字符
        return fileName
            .replace(/[\\/:*?"<>|#]/g, '_') // 替换 Windows 不允许的字符和 # 符号
            .replace(/\s+/g, ' ')           // 将多个空格替换为单个空格
            .trim();                        // 移除首尾空格
    }

    private async downloadResource(resource: { name: string; filename: string; type?: string }, targetDir: string): Promise<string | null> {
        try {
            const resourceId = resource.name.split('/').pop() || resource.name;
            const resourceUrl = `${this.settings.memosApiUrl.replace('/api/v1', '')}/file/resources/${resourceId}/${encodeURIComponent(resource.filename)}`;

            // 创建资源目录
            const resourceDir = `${targetDir}/resources`;
            await this.ensureDirectoryExists(resourceDir);

            // 生成本地文件名，避免文件名冲突
            const localFilename = `${resourceId}_${this.sanitizeFileName(resource.filename)}`;
            const localPath = `${resourceDir}/${localFilename}`;

            // 检查文件是否已存在
            if (await this.app.vault.adapter.exists(localPath)) {
                console.log(`Resource already exists: ${localPath}`);
                return localPath;
            }

            console.log(`Downloading resource: ${resourceUrl}`);

            // 下载文件
            const response = await fetch(resourceUrl, {
                headers: {
                    'Authorization': `Bearer ${this.settings.memosAccessToken}`
                }
            });

            if (!response.ok) {
                console.error(`Failed to download resource: ${response.status} ${response.statusText}`);
                return null;
            }

            const buffer = await response.arrayBuffer();
            await this.app.vault.adapter.writeBinary(localPath, buffer);
            console.log(`Resource downloaded to: ${localPath}`);

            return localPath;
        } catch (error) {
            console.error('Error downloading resource:', error);
            return null;
        }
    }

    private getRelativePath(fromPath: string, toPath: string): string {
        // 将路径转换为数组
        const fromParts = fromPath.split('/');
        const toParts = toPath.split('/');

        // 移除文件名，只保留目录路径
        fromParts.pop();

        // 找到共同的前缀
        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
            i++;
        }

        // 构建相对路径
        const goBack = fromParts.length - i;
        const relativePath = [
            ...Array(goBack).fill('..'),
            ...toParts.slice(i)
        ].join('/');

        console.log(`Relative path from ${fromPath} to ${toPath}: ${relativePath}`);
        return relativePath;
    }

    private async saveMemoToFile(memo: MemoItem) {
        const date = new Date(memo.createTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        
        const yearDir = `${this.settings.syncDirectory}/${year}`;
        const monthDir = `${yearDir}/${month}`;
        
        await this.ensureDirectoryExists(yearDir);
        await this.ensureDirectoryExists(monthDir);
        
        // 优化文件名格式：内容在前，时间在后
        const contentPreview = memo.content 
            ? this.sanitizeFileName(memo.content.slice(0, 50))  // 增加预览长度到50字符
            : this.sanitizeFileName(memo.name.replace('memos/', ''));
        
        const timeStr = this.formatDateTime(date, 'filename');
        const fileName = this.sanitizeFileName(`${contentPreview} (${timeStr}).md`);
        const filePath = `${monthDir}/${fileName}`;
        
        let content = memo.content || '';
        
        // 处理标签：将 #tag# 格式转换为 #tag
        content = content.replace(/\#([^\#\s]+)\#/g, '#$1');
        
        // 构建文档内容，正文优先
        let documentContent = content;

        // 添加资源
        if (memo.resources && memo.resources.length > 0) {
            // 分别处理图片和其他附件
            const images = memo.resources.filter(r => this.isImageFile(r.filename));
            const otherFiles = memo.resources.filter(r => !this.isImageFile(r.filename));

            // 先添加图片
            if (images.length > 0) {
                documentContent += '\n\n';
                for (const image of images) {
                    const localPath = await this.downloadResource(image, monthDir);
                    if (localPath) {
                        const relativePath = this.getRelativePath(filePath, localPath);
                        documentContent += `![${image.filename}](${relativePath})\n`;
                    } else {
                        console.error(`Failed to download image: ${image.filename}`);
                    }
                }
            }

            // 再添加其他附件
            if (otherFiles.length > 0) {
                documentContent += '\n\n### Attachments\n';
                for (const file of otherFiles) {
                    const localPath = await this.downloadResource(file, monthDir);
                    if (localPath) {
                        const relativePath = this.getRelativePath(filePath, localPath);
                        documentContent += `- [${file.filename}](${relativePath})\n`;
                    } else {
                        console.error(`Failed to download file: ${file.filename}`);
                    }
                }
            }
        }

        // 提取标签
        const tags = (memo.content || '').match(/\#([^\#\s]+)(?:\#|\s|$)/g) || [];
        const cleanTags = tags.map(tag => tag.replace(/^\#|\#$/g, '').trim());
        
        // 添加属性区域（使用 Obsidian callout，默认折叠）
        documentContent += '\n\n---\n';
        documentContent += '> [!note]- Memo Properties\n';
        documentContent += `> - Created: ${this.formatDateTime(new Date(memo.createTime))}\n`;
        documentContent += `> - Updated: ${this.formatDateTime(new Date(memo.updateTime))}\n`;
        documentContent += '> - Type: memo\n';
        if (cleanTags.length > 0) {
            documentContent += `> - Tags: [${cleanTags.join(', ')}]\n`;
        }
        documentContent += `> - ID: ${memo.name}\n`;
        documentContent += `> - Visibility: ${memo.visibility.toLowerCase()}\n`;

        try {
            const exists = await this.app.vault.adapter.exists(filePath);
            if (exists) {
                const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
                if (file) {
                    await this.app.vault.modify(file, documentContent);
                }
            } else {
                await this.app.vault.create(filePath, documentContent);
            }
            console.log(`Saved memo to: ${filePath}`);
        } catch (error) {
            console.error(`Failed to save memo to file: ${filePath}`, error);
            throw new Error(`Failed to save memo: ${error.message}`);
        }
    }

    private isImageFile(filename: string): boolean {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = filename.toLowerCase().split('.').pop();
        return ext ? imageExtensions.includes(`.${ext}`) : false;
    }

    private async ensureDirectoryExists(dirPath: string) {
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(dirPath))) {
            await adapter.mkdir(dirPath);
        }
    }

    async syncMemos() {
        try {
            if (!this.settings.memosApiUrl) {
                throw new Error('Memos API URL is not configured');
            }
            if (!this.settings.memosAccessToken) {
                throw new Error('Memos Access Token is not configured');
            }

            this.displayMessage('Sync started');

            await this.ensureDirectoryExists(this.settings.syncDirectory);

            const memos = await this.fetchAllMemos();
            this.displayMessage(`Found ${memos.length} memos`);

            let syncCount = 0;
            for (const memo of memos) {
                await this.saveMemoToFile(memo);
                syncCount++;
            }

            this.displayMessage(`Successfully synced ${syncCount} memos`);
        } catch (error) {
            console.error('Sync failed:', error);
            this.displayMessage('Sync failed: ' + error.message, true);
        }
    }

    private displayMessage(message: string, isError = false) {
        new Notice(message);
    }
}

class MemosSyncSettingTab extends PluginSettingTab {
    plugin: MemosSyncPlugin;

    constructor(app: App, plugin: MemosSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Memos API URL')
            .setDesc('Enter your Memos API URL (e.g., https://your-memos-host/api/v1)')
            .addText(text => text
                .setPlaceholder('https://your-memos-host/api/v1')
                .setValue(this.plugin.settings.memosApiUrl)
                .onChange(async (value) => {
                    let url = value.trim();
                    if (url && !url.endsWith('/api/v1')) {
                        url = url.replace(/\/?$/, '/api/v1');
                        text.setValue(url);
                    }
                    this.plugin.settings.memosApiUrl = url;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Memos Access Token')
            .setDesc('Enter your Memos Access Token')
            .addText(text => text
                .setPlaceholder('your-access-token')
                .setValue(this.plugin.settings.memosAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.memosAccessToken = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Sync Directory')
            .setDesc('Directory where memos will be synced')
            .addText(text => text
                .setPlaceholder('memos')
                .setValue(this.plugin.settings.syncDirectory)
                .onChange(async (value) => {
                    this.plugin.settings.syncDirectory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Sync Limit')
            .setDesc('Maximum number of memos to sync (default: 1000)')
            .addText(text => text
                .setPlaceholder('1000')
                .setValue(String(this.plugin.settings.syncLimit))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.plugin.settings.syncLimit = numValue;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Sync Frequency')
            .setDesc('Choose how often to sync')
            .addDropdown(dropdown => dropdown
                .addOption('manual', 'Manual')
                .addOption('auto', 'Automatic')
                .setValue(this.plugin.settings.syncFrequency)
                .onChange(async (value: 'manual' | 'auto') => {
                    this.plugin.settings.syncFrequency = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto Sync Interval')
            .setDesc('How often to sync (in minutes) when auto sync is enabled')
            .addText(text => text
                .setPlaceholder('30')
                .setValue(String(this.plugin.settings.autoSyncInterval))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.plugin.settings.autoSyncInterval = numValue;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
