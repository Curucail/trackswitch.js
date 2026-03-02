declare module 'papaparse' {
    export interface ParseConfig {
        delimiter?: string;
        skipEmptyLines?: boolean | 'greedy';
    }

    export interface ParseError {
        type?: string;
        code?: string;
        message: string;
        row?: number;
    }

    export interface ParseResult<T> {
        data: T[];
        errors: ParseError[];
    }

    export interface PapaStatic {
        parse<T = string[]>(input: string, config?: ParseConfig): ParseResult<T>;
    }

    const Papa: PapaStatic;
    export default Papa;
}